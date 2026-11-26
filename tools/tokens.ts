#!/usr/bin/env node

/*
Name: Token Scanner
Version: 1.0.0
This file will scan the blockchain for new token contracts and update the database.
*/

import '../lib/env'; // .env / .env.local before any other module reads process.env
import Web3 from 'web3';
import mongoose from 'mongoose';
import { ERC20ABI } from '../abi/TokenFactoryABI';
import fs from 'fs';
import path from 'path';
import { requireDb } from '../lib/db/get-db';
import {
  TRANSFER_TOPIC,
  erc20TransferFromLog,
  storeErc20Transfers,
  type Erc20TransferDoc,
} from '../lib/sync/token-transfers';

// Import NFT service for ownership calculation
import {
  ZERO_ADDR,
  DEAD_ADDR,
  calculateNftOwnership,
  TokenTransfer,
} from '../lib/services/nft.service';

// Basic VRC-721 (ERC721 Compatible) ABI for tokenURI and name
const minimalErc721Abi = [
  {
    constant: true,
    inputs: [],
    name: 'name',
    outputs: [{ name: '', type: 'string' }],
    type: 'function',
  },
  {
    constant: true,
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    type: 'function',
  },
  {
    constant: true,
    inputs: [{ name: '_tokenId', type: 'uint256' }],
    name: 'tokenURI',
    outputs: [{ name: '', type: 'string' }],
    type: 'function',
  },
  {
    constant: true,
    inputs: [{ name: 'interfaceId', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', type: 'bool' }],
    type: 'function',
  },
];

import {
  connectDB,
  ensureIndexesOnStartup,
  Block,
  Contract,
  InternalTransaction,
  Token,
  ScanProgress,
  Transaction,
} from '../models/index';
import { syncLaunchpadTokens } from '../lib/launchpad/sync';
import { loadConfig, getFeatures, getWeb3ProviderURL } from '../lib/config';
import {
  createErc1155Node,
  syncErc1155ToConfirmedHead,
  type Erc1155Node,
} from '../lib/sync/erc1155';
import { resolveSyncSettings } from '../lib/sync/reorg';
import { hiddenFields } from '../lib/security/display-name';

// LP Token configuration - loaded from environment or fetched from factory
const LP_TOKEN_TYPES = ['LP', 'SLP', 'SLP-V2', 'UNI-V2', 'CAKE-LP'] as const;

// Initialize database connection
const initDB = async () => {
  try {
    // Check if already connected
    if (mongoose.connection.readyState === 1) {
      return;
    }

    await connectDB();

    // Wait for connection to be fully established
    let retries = 0;
    const maxRetries = 30;
    while ((mongoose.connection.readyState as number) !== 1 && retries < maxRetries) {
      console.log('⌛ Waiting for database connection...');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      retries++;
    }

    if ((mongoose.connection.readyState as number) !== 1) {
      throw new Error('Database connection timeout');
    }

    console.log('🔗 Database connection initialized successfully');

    // Create any schema-declared index that is still missing (never drops, never throws)
    await ensureIndexesOnStartup('tokens');
  } catch (error) {
    console.error('❌ Failed to connect to database:', error);
    throw error;
  }
};

// Database disconnection function
async function disconnect() {
  try {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('MongoDB disconnection error:', error);
  }
}

// --- Configuration ---
const config = loadConfig();
const WEB3_PROVIDER_URL = getWeb3ProviderURL(); // Use centralized config
const START_BLOCK = 0; // Default start block if no sync state is found
/** Stored blocks per query when looking for contract creations. */
const CREATION_SCAN_RANGE = 100_000;
const SCAN_INTERVAL_MS = 900000; // 15 minutes (extended for CPU relief)
const BATCH_DELAY_MS = 1000; // Longer delay to reduce CPU load
const MEMORY_LIMIT_MB = parseInt(process.env.MEMORY_LIMIT_MB || '512'); // Optimized for 2GB instances

const web3 = new Web3(new Web3.providers.HttpProvider(WEB3_PROVIDER_URL));

/**
 * eth_getCode is '0x' for externally owned accounts and self-destructed
 * contracts. A token record is never created for such an address (the old
 * registration API did, leaving "Unknown" tokens behind; see
 * `flag-spam-tokens --audit-code`).
 */
async function hasContractCode(address: string): Promise<boolean> {
  const code = await web3.eth.getCode(address);
  return typeof code === 'string' && /^0x[0-9a-fA-F]+$/.test(code) && !/^0x0*$/.test(code);
}

// Memory monitoring function
const checkMemory = () => {
  const usage = process.memoryUsage();
  const usedMB = Math.round(usage.heapUsed / 1024 / 1024);

  if (usedMB > MEMORY_LIMIT_MB) {
    console.log(`⚠️ Memory usage: ${usedMB}MB (limit: ${MEMORY_LIMIT_MB}MB)`);
    if (global.gc) {
      global.gc();
      console.log('🧹 Garbage collection executed');
    }
    return false;
  }
  return true;
};

async function isErc20Token(contractAddress: string): Promise<boolean> {
  try {
    const contract = new web3.eth.Contract(ERC20ABI, contractAddress);
    // Check for mandatory ERC20 functions - name, symbol, decimals are required
    // totalSupply might fail due to EVM opcode issues (like SELFBALANCE)
    await contract.methods.name().call();
    await contract.methods.symbol().call();
    await contract.methods.decimals().call();

    // Try totalSupply but don't fail if it throws due to opcode issues
    try {
      await contract.methods.totalSupply().call();
    } catch (supplyError: any) {
      // Log the error but continue - might be EVM opcode compatibility issue
      console.log(`⚠️ totalSupply() failed for ${contractAddress}: ${supplyError.message}`);
      console.log(`  (Continuing anyway - name/symbol/decimals are valid)`);
    }

    return true;
  } catch (error: any) {
    // name/symbol/decimals failing is the normal answer of a contract that is not a token
    if (!config.quiet) {
      console.log(`↪ ${contractAddress} is not an ERC-20 token (${error.message})`);
    }
    return false;
  }
}

async function isErc721Token(contractAddress: string): Promise<boolean> {
  try {
    const contract = new web3.eth.Contract(minimalErc721Abi as any, contractAddress);
    // ERC721 interface ID is 0x80ac58cd. Check for ERC165 support.
    const supportsErc721Interface = await contract.methods.supportsInterface('0x80ac58cd').call();
    if (supportsErc721Interface) {
      return true;
    }
    // Fallback for contracts that don't explicitly support ERC165,
    // but might still have VRC-721 functions.
    // We check for tokenURI as a key indicator.
    await contract.methods.tokenURI(1).call();
    return true;
  } catch (error) {
    // If calls fail, it's not a standard VRC-721 token.
    // We can add more specific checks if needed.
    return false;
  }
}

// ERC721/VRC-721 Transfer event signature
const ERC721_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * The Transfer events of a VRC-721 token in the blocks from..to (one eth_getLogs call), with the
 * time of their stored block; `complete` is false when they could not be read.
 */
async function getTokenTransfers(
  tokenAddress: string,
  fromBlock: number,
  toBlock: number
): Promise<{ transfers: any[]; complete: boolean }> {
  try {
    const logs = await retryWeb3Call(() =>
      web3.eth.getPastLogs({
        address: tokenAddress,
        topics: [ERC721_TRANSFER_TOPIC],
        fromBlock,
        toBlock,
      })
    );
    if (logs.length === 0) return { transfers: [], complete: true };
    const heights = [...new Set(logs.map((log: any) => Number(log.blockNumber)))];
    const blocks = (await Block.find({ number: { $in: heights } })
      .select({ number: 1, timestamp: 1, _id: 0 })
      .lean()) as Array<{ number: number; timestamp: number }>;
    const timeOf = new Map(blocks.map((block) => [block.number, block.timestamp]));
    if (timeOf.size < heights.length) return { transfers: [], complete: false };
    const transfers = logs.map((log: any) => ({
      transactionHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
      // from, to and the token id are the three indexed topics
      from: `0x${log.topics[1].slice(26)}`.toLowerCase(),
      to: `0x${log.topics[2].slice(26)}`.toLowerCase(),
      value: '1',
      tokenAddress: tokenAddress.toLowerCase(),
      timestamp: new Date(Number(timeOf.get(Number(log.blockNumber))) * 1000),
      tokenId: web3.utils.hexToNumber(log.topics[3] || log.data),
    }));
    return { transfers, complete: true };
  } catch (error) {
    console.error(`❌ Error getting transfers for token ${tokenAddress}:`, error);
    return { transfers: [], complete: false };
  }
}

// Zero address constants are imported from nft.service (ZERO_ADDR, DEAD_ADDR)

// Function to calculate token holders from transfers with optimization (for NFTs - balance ±1)
async function calculateTokenHolders(transfers: any[]): Promise<any[]> {
  const holderBalances = new Map<string, number>();

  // Process transfers in batches
  const batchSize = 500;
  for (let i = 0; i < transfers.length; i += batchSize) {
    const batch = transfers.slice(i, i + batchSize);

    for (const transfer of batch) {
      const { from, to } = transfer;

      // If from is zero address, it's a mint
      if (from !== ZERO_ADDR) {
        const currentFrom = holderBalances.get(from) || 0;
        holderBalances.set(from, currentFrom - 1);
      }

      // Add to recipient (skip if burn to zero address)
      if (to !== ZERO_ADDR) {
        const currentTo = holderBalances.get(to) || 0;
        holderBalances.set(to, currentTo + 1);
      }
    }

    // Memory check between batches
    if (!checkMemory()) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Filter out zero balances and create holders array
  const holders = [];
  let rank = 1;

  for (const [address, balance] of holderBalances.entries()) {
    if (balance > 0) {
      holders.push({
        tokenAddress: transfers[0]?.tokenAddress || '',
        holderAddress: address,
        balance: balance.toString(),
        percentage: 0, // Will be calculated after we know total supply
        rank: rank++,
      });
    }
  }

  // Sort by balance (highest first) and recalculate ranks
  holders.sort((a, b) => parseInt(b.balance) - parseInt(a.balance));

  // Calculate percentages based on total supply
  const totalSupply = holders.reduce((sum, holder) => sum + parseInt(holder.balance), 0);
  holders.forEach((holder, index) => {
    holder.rank = index + 1;
    holder.percentage = totalSupply > 0 ? (parseInt(holder.balance) / totalSupply) * 100 : 0;
  });

  return holders;
}

// Helper function to retry web3 calls with exponential backoff
async function retryWeb3Call<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const isRetryable =
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNREFUSED' ||
        error.message?.includes('socket hang up') ||
        error.message?.includes('timeout');

      if (!isRetryable || attempt === maxRetries - 1) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`⏳ Retry ${attempt + 1}/${maxRetries} after ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * The Transfer events of a VRC-20 token in the blocks from..to (one eth_getLogs call), with the
 * time of their stored block. `complete` is false when the logs could not be read or a block is
 * not stored; the caller then keeps its marker and tries again.
 */
async function getErc20TokenTransfers(
  tokenAddress: string,
  fromBlock: number,
  toBlock: number
): Promise<{ transfers: Erc20TransferDoc[]; complete: boolean }> {
  try {
    const logs = await retryWeb3Call(() =>
      web3.eth.getPastLogs({ address: tokenAddress, topics: [TRANSFER_TOPIC], fromBlock, toBlock })
    );
    if (logs.length === 0) return { transfers: [], complete: true };
    const heights = [...new Set(logs.map((log: any) => Number(log.blockNumber)))];
    const blocks = (await Block.find({ number: { $in: heights } })
      .select({ number: 1, timestamp: 1, _id: 0 })
      .lean()) as Array<{ number: number; timestamp: number }>;
    const timeOf = new Map(blocks.map((block) => [block.number, block.timestamp]));
    if (timeOf.size < heights.length) return { transfers: [], complete: false };
    const transfers = logs
      // null: not a VRC-20 transfer (fewer than three topics)
      .map((log: any) =>
        erc20TransferFromLog(log, tokenAddress, timeOf.get(Number(log.blockNumber)) ?? 0)
      )
      .filter((transfer): transfer is Erc20TransferDoc => transfer !== null);
    return { transfers, complete: true };
  } catch (error) {
    console.error(`❌ Error fetching VRC-20 transfers for ${tokenAddress}:`, error);
    return { transfers: [], complete: false };
  }
}

// Function to calculate VRC-20 token holders from transfers (balance from actual values)
async function calculateErc20TokenHolders(transfers: any[], tokenAddress: string): Promise<any[]> {
  const holderBalances = new Map<string, bigint>();

  for (const transfer of transfers) {
    const { from, to, value } = transfer;
    const transferValue = BigInt(value || '0');

    // Subtract from sender (unless mint from zero address)
    if (from !== ZERO_ADDR) {
      const currentFrom = holderBalances.get(from) || 0n;
      holderBalances.set(from, currentFrom - transferValue);
    }

    // Add to recipient (skip if burn to zero address)
    if (to !== ZERO_ADDR) {
      const currentTo = holderBalances.get(to) || 0n;
      holderBalances.set(to, currentTo + transferValue);
    }
  }

  // Filter out zero/negative balances and create holders array
  const holders = [];
  let rank = 1;

  for (const [address, balance] of holderBalances.entries()) {
    if (balance > 0n) {
      holders.push({
        tokenAddress: tokenAddress.toLowerCase(),
        holderAddress: address,
        balance: balance.toString(),
        percentage: 0,
        rank: rank++,
      });
    }
  }

  // Sort by balance (highest first) and recalculate ranks
  holders.sort((a, b) => {
    const balA = BigInt(a.balance);
    const balB = BigInt(b.balance);
    if (balB > balA) return 1;
    if (balB < balA) return -1;
    return 0;
  });

  // Calculate percentages based on total supply
  const totalSupply = holders.reduce((sum, h) => sum + BigInt(h.balance), 0n);
  holders.forEach((holder, index) => {
    holder.rank = index + 1;
    holder.percentage =
      totalSupply > 0n ? Number((BigInt(holder.balance) * 10000n) / totalSupply) / 100 : 0;
  });

  return holders;
}

// Function to update VRC-20 token data with real blockchain data
/**
 * Reads the Transfer events of a VRC-20 / LP token after its marker (`transfersScannedTo`) up to
 * the confirmed stored head and, when there are new ones, recomputes its holders and supply from
 * every stored transfer. Until 2026-11-27 it read the whole history every five minutes and asked
 * the node for the block of every event.
 */
async function updateErc20TokenWithRealData(tokenAddress: string, toBlock: number) {
  const address = tokenAddress.toLowerCase();
  try {
    const token = (await Token.findOne({ address }).select('transfersScannedTo').lean()) as {
      transfersScannedTo?: number;
    } | null;
    const fromBlock = (token?.transfersScannedTo ?? -1) + 1;
    if (fromBlock > toBlock) return;
    const { transfers, complete } = await getErc20TokenTransfers(address, fromBlock, toBlock);
    if (!complete) {
      console.warn(`⚠️ Transfers of VRC-20 token ${address} not read; trying again next round`);
      return;
    }
    if (transfers.length > 0) {
      const db = requireDb();
      // from block 0 the list is the whole history: documents stored without a log index go
      await storeErc20Transfers(db.collection('tokentransfers'), address, transfers, {
        complete: fromBlock === 0,
      });
      await recomputeErc20Holders(address);
    }
    await Token.updateOne({ address }, { $set: { transfersScannedTo: toBlock } });
  } catch (error) {
    console.error(`❌ Error updating VRC-20 token ${address}:`, error);
  }
}

/** Holders, supply and holder count of a VRC-20 token from its stored transfers. */
async function recomputeErc20Holders(address: string): Promise<void> {
  const db = requireDb();
  const transfers = await db
    .collection('tokentransfers')
    .find({ tokenAddress: address, tokenId: { $exists: false }, logIndex: { $exists: true } })
    .project({ from: 1, to: 1, value: 1, _id: 0 })
    .toArray();
  const holders = await calculateErc20TokenHolders(transfers, address);
  for (let i = 0; i < holders.length; i += 200) {
    await db.collection('tokenholders').bulkWrite(
      holders.slice(i, i + 200).map((holder) => ({
        updateOne: {
          filter: { tokenAddress: holder.tokenAddress, holderAddress: holder.holderAddress },
          update: { $set: holder },
          upsert: true,
        },
      }))
    );
  }
  await db.collection('tokenholders').deleteMany({
    tokenAddress: address,
    holderAddress: { $nin: holders.map((holder) => holder.holderAddress) },
  });
  const totalSupply = holders.reduce((sum, holder) => sum + BigInt(holder.balance), 0n);
  await db.collection('tokens').updateOne(
    { address },
    {
      $set: {
        supply: totalSupply.toString(),
        totalSupply: totalSupply.toString(),
        holders: holders.length,
        updatedAt: new Date(),
      },
    }
  );
  console.log(`✅ VRC-20 ${address}: ${transfers.length} transfers, ${holders.length} holders`);
}

/** The stored head minus the sync confirmations: the blocks up to it no longer change. */
async function confirmedStoredHead(): Promise<number> {
  const head = (await Block.findOne().sort({ number: -1 }).select('number').lean()) as {
    number: number;
  } | null;
  const { confirmations } = resolveSyncSettings(
    (loadConfig() as { sync?: { confirmations?: unknown; maxReorgDepth?: unknown } }).sync
  );
  return (head?.number ?? -1) - confirmations - 1;
}

// Function to update all VRC-20 tokens at once (including LP tokens)
async function updateAllErc20Tokens() {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.log('🔌 Reconnecting to database for VRC-20 update...');
      await connectDB();
    }

    // VRC-20 tokens and LP tokens (LP tokens use same transfer format as ERC20)
    const tokens = await Token.find({
      type: { $in: ['VRC-20', 'ERC20', 'LP', 'SLP', 'SLP-V2', 'UNI-V2', 'CAKE-LP'] },
    });
    // each token reads on from its marker up to the confirmed stored head
    const toBlock = await confirmedStoredHead();
    for (const token of tokens) await updateErc20TokenWithRealData(token.address, toBlock);
  } catch (error) {
    console.error('❌ Error in updateAllErc20Tokens:', error);
  }
}

/**
 * Reads the Transfer events of a VRC-721 token after its marker (`transfersScannedTo`) up to the
 * confirmed stored head and, when there are new ones, recomputes its holders and supply from the
 * stored transfers. Orphaned transfers are removed by replaceBlock(), which also rewinds the
 * marker. Until 2026-11-27 it read the whole history of every token every 15 minutes, asked the
 * node for the block of every event and loaded every stored transfer to find stale ones.
 */
async function updateTokenWithRealData(tokenAddress: string, toBlock: number) {
  const address = tokenAddress.toLowerCase();
  try {
    const token = (await Token.findOne({ address }).select('transfersScannedTo').lean()) as {
      transfersScannedTo?: number;
    } | null;
    const fromBlock = (token?.transfersScannedTo ?? -1) + 1;
    if (fromBlock > toBlock) return;
    const { transfers, complete } = await getTokenTransfers(address, fromBlock, toBlock);
    if (!complete) {
      console.warn(`⚠️ Transfers of VRC-721 token ${address} not read; trying again next round`);
      return;
    }
    if (transfers.length > 0) {
      const db = requireDb();
      for (let i = 0; i < transfers.length; i += 200) {
        await db.collection('tokentransfers').bulkWrite(
          transfers.slice(i, i + 200).map((transfer) => ({
            updateOne: {
              // mint, burn and transfer of one token id in one block differ by `to`
              filter: {
                tokenAddress: transfer.tokenAddress,
                tokenId: transfer.tokenId,
                blockNumber: transfer.blockNumber,
                to: transfer.to,
              },
              update: { $set: transfer },
              upsert: true,
            },
          }))
        );
      }
      await recomputeNftHolders(address);
    }
    await Token.updateOne({ address }, { $set: { transfersScannedTo: toBlock } });
  } catch (error) {
    console.error(`❌ Error updating VRC-721 token ${address}:`, error);
  }
}

/** Holders, supply (minted tokens) and holder count of a VRC-721 token from its stored transfers. */
async function recomputeNftHolders(address: string): Promise<void> {
  const db = requireDb();
  const transfers = await db
    .collection('tokentransfers')
    .find({ tokenAddress: address, tokenId: { $exists: true } })
    .sort({ blockNumber: 1 })
    .project({ from: 1, to: 1, tokenId: 1, blockNumber: 1, _id: 0 })
    .toArray();
  const holders = await calculateTokenHolders(
    transfers.map((transfer) => ({ ...transfer, tokenAddress: address }))
  );
  for (let i = 0; i < holders.length; i += 200) {
    await db.collection('tokenholders').bulkWrite(
      holders.slice(i, i + 200).map((holder) => ({
        updateOne: {
          filter: { tokenAddress: holder.tokenAddress, holderAddress: holder.holderAddress },
          update: { $set: holder },
          upsert: true,
        },
      }))
    );
  }
  await db.collection('tokenholders').deleteMany({
    tokenAddress: address,
    holderAddress: { $nin: holders.map((holder) => holder.holderAddress) },
  });
  const minted = transfers.filter((transfer) => transfer.from === ZERO_ADDR).length;
  await db.collection('tokens').updateOne(
    { address },
    {
      $set: {
        supply: String(minted),
        totalSupply: String(minted),
        holders: holders.length,
        updatedAt: new Date(),
      },
    }
  );
  console.log(`✅ VRC-721 ${address}: ${transfers.length} transfers, ${holders.length} holders`);
}

/**
 * Register the token at `contractAddress` (VRC-20 or VRC-721) in `tokens` and
 * `Contract` when it is one and not known yet. Used for contracts created by a
 * transaction (scanForTokens) and by another contract (adoptContractsCreatedByContracts).
 */
async function registerTokenContract(
  contractAddress: string,
  blockNumber: number | bigint,
  existingTokenAddresses: Set<string>
): Promise<'created' | 'exists' | 'none'> {
  // Skip if token already exists
  if (existingTokenAddresses.has(contractAddress.toLowerCase())) {
    return 'exists';
  }

  console.log(`🏗️ Potential contract found at address: ${contractAddress} in block ${blockNumber}`);

  // Check if it's an ERC20 token
  if (await isErc20Token(contractAddress)) {
    // Check if token already exists in DB
    const existingToken = await Token.findOne({
      address: contractAddress.toLowerCase(),
    }).lean();

    if (existingToken) {
      console.log(`⏭️ Skipping existing ERC20 token: ${contractAddress} (already in DB)`);
      return 'exists';
    }

    if (!(await hasContractCode(contractAddress))) {
      console.log(`⏭️ Skipping ${contractAddress}: no contract code at this address`);
      return 'none';
    }

    const contract = new web3.eth.Contract(ERC20ABI, contractAddress);
    const name = (await contract.methods.name().call()) as string;
    const symbol = (await contract.methods.symbol().call()) as string;
    const decimals = (await contract.methods.decimals().call()) as bigint;

    // totalSupply might fail due to EVM opcode issues, default to 0
    let totalSupply: bigint = 0n;
    try {
      totalSupply = (await contract.methods.totalSupply().call()) as bigint;
    } catch (supplyError: any) {
      console.log(`⚠️ Could not get totalSupply for ${name}: ${supplyError.message}`);
      console.log(`  (Setting totalSupply to 0)`);
    }

    console.log(`🪙 Found ERC20 Token: ${name} (${symbol})`);

    // Ensure DB connection before database operations
    if (mongoose.connection.readyState !== 1) {
      console.log('🔌 Reconnecting to database for ERC20 token...');
      await connectDB();
    }

    // Add new token to the database
    const newToken = new Token({
      name,
      symbol,
      address: contractAddress.toLowerCase(),
      decimals: Number(decimals),
      totalSupply: totalSupply.toString(),
      type: 'VRC-20',
      holders: 0,
      supply: totalSupply.toString(),
      ...hiddenFields({ name, symbol }),
    });
    await newToken.save();

    // Also add to Contract collection for consistency
    try {
      const existingContract = await Contract.findOne({
        address: contractAddress.toLowerCase(),
      });
      if (!existingContract) {
        const newContract = new Contract({
          address: contractAddress.toLowerCase(),
          contractName: name,
          tokenName: name,
          symbol: symbol,
          ...hiddenFields({ name, symbol }),
          decimals: Number(decimals),
          totalSupply: Number(totalSupply),
          ERC: 2, // ERC20 = 2
          verified: false,
          blockNumber: blockNumber,
        });
        await newContract.save();
        console.log(`📝 Added contract ${contractAddress} to Contract collection`);
      }
    } catch (contractError) {
      console.warn(
        `⚠️ Failed to add contract ${contractAddress} to Contract collection:`,
        contractError
      );
    }

    existingTokenAddresses.add(contractAddress.toLowerCase());
    return 'created';
  } else if (await isErc721Token(contractAddress)) {
    console.log(`🎨 Contract ${contractAddress} is a VRC-721 (ERC721 Compatible) token.`);

    // Check if token already exists in DB
    const existingToken = await Token.findOne({
      address: contractAddress.toLowerCase(),
    }).lean();

    if (existingToken) {
      console.log(`⏭️ Skipping existing VRC-721 token: ${contractAddress} (already in DB)`);
      return 'exists';
    }

    if (!(await hasContractCode(contractAddress))) {
      console.log(`⏭️ Skipping ${contractAddress}: no contract code at this address`);
      return 'none';
    }

    const tokenContract = new web3.eth.Contract(minimalErc721Abi as any, contractAddress);
    try {
      const name = await tokenContract.methods.name().call();
      const symbol = await tokenContract.methods.symbol().call();
      const decimals = 0;
      const totalSupply = 0;

      // Ensure DB connection before database operations
      if (mongoose.connection.readyState !== 1) {
        console.log('🔌 Reconnecting to database for VRC-721 token...');
        await connectDB();
      }

      // Add new token to the database
      const newToken = new Token({
        name,
        symbol,
        address: contractAddress.toLowerCase(),
        decimals,
        totalSupply: totalSupply.toString(),
        type: 'VRC-721',
        holders: 0,
        supply: totalSupply.toString(),
        ...hiddenFields({ name: String(name ?? ''), symbol: String(symbol ?? '') }),
      });
      await newToken.save();

      // Also add to Contract collection for consistency
      try {
        const existingContract = await Contract.findOne({
          address: contractAddress.toLowerCase(),
        });
        if (!existingContract) {
          const newContract = new Contract({
            address: contractAddress.toLowerCase(),
            contractName: name,
            tokenName: name,
            symbol: symbol,
            ...hiddenFields({
              name: String(name ?? ''),
              symbol: String(symbol ?? ''),
            }),
            decimals: 0,
            totalSupply: 0,
            ERC: 3, // VRC-721 = 3 (similar to ERC721)
            verified: false,
            blockNumber: blockNumber,
          });
          await newContract.save();
          console.log(`📝 Added VRC-721 contract ${contractAddress} to Contract collection`);
        }
      } catch (contractError) {
        console.warn(
          `⚠️ Failed to add VRC-721 contract ${contractAddress} to Contract collection:`,
          contractError
        );
      }

      existingTokenAddresses.add(contractAddress.toLowerCase());
      return 'created';
    } catch (e) {
      console.error(`❌ Error fetching details for VRC-721 token ${contractAddress}:`, e);
      return 'none';
    }
  }
  return 'none';
}

async function scanForTokens() {
  console.log('🔍 Starting incremental token scan...');
  try {
    // Ensure DB connection is active
    if (mongoose.connection.readyState !== 1) {
      console.log('🔌 Reconnecting to database...');
      await connectDB();
    }

    // Double-check connection
    if (mongoose.connection.readyState !== 1) {
      console.error('❌ Database connection failed after reconnection attempt');
      return;
    }
  } catch (error) {
    console.error('Failed to connect to database:', error);
    return;
  }

  try {
    // Get the latest scanned block from database
    let scanProgress = await ScanProgress.findOne({ scanType: 'tokens' });
    if (!scanProgress) {
      // Create initial scan progress record
      scanProgress = new ScanProgress({
        scanType: 'tokens',
        lastScannedBlock: START_BLOCK,
        lastUpdateTime: new Date(),
      });
      await scanProgress.save();
    }

    // Contract creations come from the stored transactions (`creates`, written by tools/sync.ts),
    // so the scan follows the stored chain and never reads past it (a reorg that replaces blocks
    // rewinds this marker). It used to fetch every block with its transactions from the node,
    // pausing between chunks: about 18 blocks a second, ahead of the stored chain.
    const head = (await Block.findOne().sort({ number: -1 }).select('number').lean()) as {
      number: number;
    } | null;
    const latestBlockNumber = head?.number ?? 0;
    let fromBlock = scanProgress.lastScannedBlock + 1;
    if (fromBlock > latestBlockNumber) {
      console.log(
        `✅ No new blocks to scan. Last scanned: ${scanProgress.lastScannedBlock}, stored head: ${latestBlockNumber}`
      );
      return;
    }
    console.log(
      `🚀 Scanning stored blocks ${fromBlock}-${latestBlockNumber} for contract creations`
    );

    const existingTokens = await Token.find({}).select('address').lean();
    const existingTokenAddresses = new Set(existingTokens.map((t) => t.address.toLowerCase()));
    let newTokensFound = 0;
    let existingTokensSkipped = 0;
    while (fromBlock <= latestBlockNumber) {
      const toBlock = Math.min(fromBlock + CREATION_SCAN_RANGE - 1, latestBlockNumber);
      const creations = (await Transaction.find({
        creates: { $ne: null },
        blockNumber: { $gte: fromBlock, $lte: toBlock },
      })
        .select('creates blockNumber')
        .sort({ blockNumber: 1 })
        .lean()) as Array<{ creates: string; blockNumber: number }>;
      for (const creation of creations) {
        const status = await registerTokenContract(
          creation.creates,
          creation.blockNumber,
          existingTokenAddresses
        );
        if (status === 'exists') existingTokensSkipped++;
        else if (status === 'created') newTokensFound++;
      }
      await ScanProgress.updateOne(
        { scanType: 'tokens' },
        { lastScannedBlock: toBlock, lastUpdateTime: new Date() },
        { upsert: true }
      );
      fromBlock = toBlock + 1;
    }
    console.log(
      `📊 Token scan up to ${latestBlockNumber}: ${newTokensFound} new tokens, ${existingTokensSkipped} already known`
    );
  } catch (error) {
    console.error('❌ An error occurred during token scanning:', error);
    // Save progress even on error
    try {
      // Get current scan progress to save partial work
      const currentProgress = await ScanProgress.findOne({ scanType: 'tokens' });
      if (currentProgress && currentProgress.lastScannedBlock > START_BLOCK) {
        console.log(`💾 Saving progress up to block ${currentProgress.lastScannedBlock}`);
      }
    } catch (progressError) {
      console.error('❌ Failed to save scan progress:', progressError);
    }
  }

  console.log(
    `✅ Incremental token scan finished. Next scan in ${SCAN_INTERVAL_MS / 1000} seconds.`
  );
}

// Function to update all VRC-721 tokens at once (optimized with batch processing)
async function updateAllVrc721Tokens() {
  try {
    // Ensure DB connection
    if (mongoose.connection.readyState !== 1) {
      console.log('🔌 Reconnecting to database for VRC-721 update...');
      await connectDB();
    }

    const tokens = await Token.find({ type: { $in: ['VRC-721', 'ERC721', 'VRC721'] } });
    console.log(`🎨 Found ${tokens.length} VRC-721 tokens to update`);

    // each token reads on from its marker up to the confirmed stored head
    const toBlock = await confirmedStoredHead();
    for (const token of tokens) await updateTokenWithRealData(token.address, toBlock);
  } catch (error) {
    console.error('❌ Error in updateAllVrc721Tokens:', error);
  }
}

// Export for use by other scripts
export { updateTokenWithRealData };

// Uniswap V2 Factory ABI (minimal for getting pairs)
const FACTORY_ABI = [
  {
    inputs: [],
    name: 'allPairsLength',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'allPairs',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// LP Token (Pair) ABI for getting token info
const LP_TOKEN_ABI = [
  {
    inputs: [],
    name: 'name',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token0',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// ERC20 ABI for getting token symbol
const ERC20_BASIC_ABI = [
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'name',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// Helper function to get pair-based LP token name and symbol
async function getLPPairInfo(pairAddress: string): Promise<{ name: string; symbol: string }> {
  try {
    const lpContract = new web3.eth.Contract(LP_TOKEN_ABI as any, pairAddress);

    // Get token0 and token1 addresses
    const [token0Address, token1Address] = await Promise.all([
      lpContract.methods.token0().call(),
      lpContract.methods.token1().call(),
    ]);

    // Get symbols for both tokens
    const token0Contract = new web3.eth.Contract(ERC20_BASIC_ABI as any, String(token0Address));
    const token1Contract = new web3.eth.Contract(ERC20_BASIC_ABI as any, String(token1Address));

    const [symbol0, symbol1] = await Promise.all([
      token0Contract.methods
        .symbol()
        .call()
        .catch(() => 'UNKNOWN'),
      token1Contract.methods
        .symbol()
        .call()
        .catch(() => 'UNKNOWN'),
    ]);

    const s0 = String(symbol0);
    const s1 = String(symbol1);

    return {
      name: `${s0}-${s1} LP`,
      symbol: `${s0}-${s1}`,
    };
  } catch (error) {
    console.error(`Error getting LP pair info for ${pairAddress}:`, error);
    return { name: 'LP Token', symbol: 'LP' };
  }
}

// Sync all LP tokens from DEX factory
async function syncLPTokensFromFactory() {
  console.log('🔄 Syncing LP tokens from DEX factory...');

  try {
    // Get factory address from config
    const config = loadConfig();
    const factoryAddress = config.dex?.factory;

    // a plain block explorer has no DEX; config.example.json ships it with zero addresses
    if (!getFeatures().dex || !factoryAddress || /^0x0{40}$/i.test(factoryAddress)) {
      console.log('⚠️ DEX disabled or no factory configured, skipping LP token sync');
      return;
    }

    console.log(`📍 Using factory address: ${factoryAddress}`);

    const factory = new web3.eth.Contract(FACTORY_ABI as any, factoryAddress);
    const pairsLengthResult = await factory.methods.allPairsLength().call();
    const pairsLength = Number(pairsLengthResult);
    console.log(`📊 Found ${pairsLength} LP pairs in factory`);

    // Ensure DB connection
    if (mongoose.connection.readyState !== 1) {
      await connectDB();
    }

    const db = requireDb();

    // Process each pair
    for (let i = 0; i < pairsLength; i++) {
      try {
        const pairAddressResult = await factory.methods.allPairs(i).call();
        const pairAddress = String(pairAddressResult);
        const normalizedAddress = pairAddress.toLowerCase();

        // Check if LP token already exists with proper name
        const existingToken = await Token.findOne({ address: normalizedAddress });
        if (existingToken) {
          // Update type if not set correctly
          if (!LP_TOKEN_TYPES.includes(existingToken.type as any)) {
            console.log(`🔧 Updating token type for ${normalizedAddress}`);
            await Token.updateOne({ address: normalizedAddress }, { $set: { type: 'LP' } });
          }

          // Update name and symbol if they are generic (SLP-V2, UNI-V2, etc.)
          if (
            existingToken.symbol === 'SLP-V2' ||
            existingToken.symbol === 'UNI-V2' ||
            existingToken.name === 'Simple LP Token V2' ||
            existingToken.name === 'Uniswap V2'
          ) {
            console.log(`🔧 Updating LP token name/symbol for ${normalizedAddress}...`);
            const pairInfo = await getLPPairInfo(pairAddress);
            await Token.updateOne(
              { address: normalizedAddress },
              { $set: { name: pairInfo.name, symbol: pairInfo.symbol } }
            );
            console.log(`✅ Updated LP token: ${pairInfo.symbol} (${normalizedAddress})`);
          }
          continue;
        }

        if (!(await hasContractCode(pairAddress))) {
          console.log(`⏭️ Skipping pair ${normalizedAddress}: no contract code at this address`);
          continue;
        }

        // Get LP token info from contract
        const lpToken = new web3.eth.Contract(LP_TOKEN_ABI as any, pairAddress);
        const [decimals, totalSupplyResult] = await Promise.all([
          lpToken.methods.decimals().call(),
          lpToken.methods.totalSupply().call(),
        ]);

        // Get human-readable name and symbol from pair tokens
        const pairInfo = await getLPPairInfo(pairAddress);

        // Register new LP token with pair-based name
        const tokenDoc = {
          address: normalizedAddress,
          name: pairInfo.name,
          symbol: pairInfo.symbol,
          decimals: Number(decimals),
          totalSupply: String(totalSupplyResult),
          type: 'LP',
          holders: 0,
          verified: true,
          ...hiddenFields({ name: pairInfo.name, symbol: pairInfo.symbol }),
        };

        await db
          .collection('tokens')
          .updateOne({ address: normalizedAddress }, { $set: tokenDoc }, { upsert: true });

        console.log(`✅ Registered LP token: ${pairInfo.symbol} (${normalizedAddress})`);

        // Small delay between pairs
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error: any) {
        console.error(`❌ Error processing pair ${i}:`, error.message);
      }
    }

    console.log('✅ LP token sync from factory complete');
  } catch (error) {
    console.error('❌ Error syncing LP tokens from factory:', error);
  }
}

/** Import Launchpad factory tokens the DB does not know yet (chain values only). */
/** Contracts created by contracts that were checked and are no token (per process). */
const probedCreatedContracts = new Set<string>();

/**
 * Tokens a contract (a factory) deployed: the block scan above only sees
 * contracts a transaction created. The creations come from the internal
 * transaction index (tools/internal-txs.ts). A created pair (token0 / token1)
 * is registered as an LP token, as syncLPTokensFromFactory() does.
 */
async function adoptContractsCreatedByContracts(): Promise<number> {
  const created = (await InternalTransaction.find({
    createdContract: { $exists: true },
    reverted: false,
    // created by a contract: a top-level creation is the block scan's
    'traceAddress.0': { $exists: true },
  })
    .select('createdContract blockNumber')
    .lean()) as Array<{ createdContract: string; blockNumber: number }>;
  if (created.length === 0) return 0;
  const existing = new Set(
    (
      (await Token.find({ address: { $in: created.map((c) => c.createdContract) } })
        .select('address')
        .lean()) as Array<{ address: string }>
    ).map((token) => token.address.toLowerCase())
  );

  let registered = 0;
  for (const { createdContract, blockNumber } of created) {
    const address = createdContract.toLowerCase();
    if (existing.has(address) || probedCreatedContracts.has(address)) continue;
    probedCreatedContracts.add(address);
    try {
      if ((await registerTokenContract(address, blockNumber, existing)) !== 'created') continue;
      registered++;
      // a pair contract: LP token named after its tokens
      const pair = new web3.eth.Contract(LP_TOKEN_ABI as any, address);
      const isPair = await Promise.all([pair.methods.token0().call(), pair.methods.token1().call()])
        .then(() => true)
        .catch(() => false);
      if (isPair) {
        const pairInfo = await getLPPairInfo(address);
        await Token.updateOne(
          { address },
          {
            $set: {
              type: 'LP',
              name: pairInfo.name,
              symbol: pairInfo.symbol,
              ...hiddenFields({ name: pairInfo.name, symbol: pairInfo.symbol }),
            },
          }
        );
      }
    } catch (error) {
      console.warn(
        `⚠️ Could not check ${address} (created by a contract):`,
        error instanceof Error ? error.message : error
      );
    }
  }
  if (registered > 0) console.log(`🏭 Registered ${registered} token(s) created by contracts`);
  return registered;
}

// ============================================
// VRC-1155
// ============================================

const ERC1155_SYNC_INTERVAL = 60 * 1000; // 1 minute
/** One JSON-RPC client for the process (the explorer's own node). */
let erc1155Node: Erc1155Node | null = null;

/** VRC-1155 transfers up to the confirmed head (lib/sync/erc1155.ts). */
async function runErc1155Sync(): Promise<void> {
  try {
    const { confirmations } = resolveSyncSettings(
      (loadConfig() as { sync?: { confirmations?: unknown; maxReorgDepth?: unknown } }).sync
    );
    erc1155Node ??= createErc1155Node(getWeb3ProviderURL());
    const result = await syncErc1155ToConfirmedHead(erc1155Node, { confirmations });
    if (result.ranges > 0) {
      console.log(
        `🧩 VRC-1155: ${result.transfers} transfer(s) in ${result.ranges} range(s), up to block ${result.lastScannedBlock}` +
          (result.registered.length > 0 ? `; new tokens: ${result.registered.join(', ')}` : '')
      );
    }
  } catch (error) {
    console.error('❌ VRC-1155 sync failed:', error instanceof Error ? error.message : error);
  }
}

const LAUNCHPAD_SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour
async function runLaunchpadSync(): Promise<void> {
  // a plain block explorer has no Launchpad (launchpad.enabled in config.json)
  if (!getFeatures().launchpad) return;
  try {
    console.log('🔄 Syncing Launchpad tokens from the TokenFactory contracts...');
    const result = await syncLaunchpadTokens();
    console.log(
      `✅ Launchpad sync: ${result.factories} factories, ${result.total} tokens, ${result.registered} registered, ${result.updated} updated, ${result.errors} errors`
    );
  } catch (error) {
    console.error('❌ Error syncing Launchpad tokens:', error);
  }
}

/**
 * The token jobs: one-off maintenance with a flag, else the token scan and periodic updates. The
 * worker calls it with no arguments; errors are thrown to the caller (the worker retries the
 * job, the command line exits with 1).
 */
async function main(args: string[] = process.argv.slice(2)) {
  try {
    // Initialize database connection first
    await initDB();

    // Check command line arguments

    if (args.includes('--help')) {
      console.log(`
Token Scanner - VBC Explorer

Usage:
  npx ts-node tools/tokens.ts [options]

Options:
  --help              Show this help message
  --rescan            Reset scan progress and rescan from block 0
  --update-all-vrc721 Update all VRC-721 token metadata
  --update-all-vrc20  Update all VRC-20 token supply data
  --sync-lp-tokens    Sync LP tokens from DEX factory and update their data
  --sync-erc1155      Sync VRC-1155 transfers up to the confirmed head
  --update-single <address>  Update a single token by address

Without options, the scanner runs continuously and:
  - Scans for new tokens every 15 minutes (also tokens deployed by contracts)
  - Updates VRC-20 token data every 5 minutes
  - Updates VRC-721 token metadata every 15 minutes
  - Syncs VRC-1155 transfers every minute
  - Syncs LP tokens from DEX factory every 1 hour
`);
      await disconnect();
      return;
    }

    // Handle --update-single option
    const updateSingleIndex = args.indexOf('--update-single');
    if (updateSingleIndex !== -1) {
      const tokenAddress = args[updateSingleIndex + 1];
      if (!tokenAddress || tokenAddress.startsWith('--')) {
        console.error('❌ Please provide a token address after --update-single');
        await disconnect();
        return;
      }
      console.log(`🔄 Updating single token: ${tokenAddress}`);
      await updateTokenWithRealData(tokenAddress, await confirmedStoredHead());
      await disconnect();
      return;
    }

    if (args.includes('--rescan')) {
      // only the token scan: the listener, repair and range indexers keep their markers
      console.log('🔄 Resetting the token scan to rescan from block 0...');
      await ScanProgress.deleteMany({ scanType: 'tokens' });
      console.log('✅ Scan progress reset. Starting fresh scan...');
    }

    if (args.includes('--update-all-vrc721')) {
      await updateAllVrc721Tokens();
      await disconnect();
      return;
    }

    if (args.includes('--update-all-vrc20')) {
      await updateAllErc20Tokens();
      await disconnect();
      return;
    }

    if (args.includes('--sync-lp-tokens')) {
      await syncLPTokensFromFactory();
      await updateAllErc20Tokens(); // LP tokens are updated with ERC20 tokens
      await disconnect();
      return;
    }

    if (args.includes('--sync-launchpad')) {
      await runLaunchpadSync();
      await disconnect();
      return;
    }

    if (args.includes('--sync-erc1155')) {
      await runErc1155Sync();
      await disconnect();
      return;
    }

    // Ensure initial DB connection
    await connectDB();

    // Initial LP token sync from factory (register any new LP tokens)
    console.log('🔄 Initial LP token sync from factory...');
    await syncLPTokensFromFactory();

    // Initial Launchpad factory import (tokens the factories know but the DB does not)
    await runLaunchpadSync();

    // Default: regular token scan + periodic auto-update of VRC-721/VRC-20 tokens
    await scanForTokens(); // Run once on start
    await adoptContractsCreatedByContracts();
    await runErc1155Sync();

    // Initial update of VRC-20 tokens (includes LP tokens)
    console.log('🔄 Initial VRC-20/LP token update...');
    await updateAllErc20Tokens();

    setInterval(async () => {
      try {
        await scanForTokens();
        await adoptContractsCreatedByContracts();
      } catch (error) {
        console.error('❌ Error in scanForTokens interval:', error);
      }
    }, SCAN_INTERVAL_MS);

    // VRC-1155 transfers (each run continues from its marker; overlapping runs are skipped)
    let erc1155Running = false;
    setInterval(async () => {
      if (erc1155Running) return;
      erc1155Running = true;
      try {
        await runErc1155Sync();
      } finally {
        erc1155Running = false;
      }
    }, ERC1155_SYNC_INTERVAL);

    // Auto-update VRC-721 tokens (at the same interval as scanForTokens)
    setInterval(async () => {
      try {
        await updateAllVrc721Tokens();
      } catch (error) {
        console.error('❌ Error in updateAllVrc721Tokens interval:', error);
      }
    }, SCAN_INTERVAL_MS);

    // Auto-update VRC-20 tokens (every 5 minutes)
    const VRC20_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
    setInterval(async () => {
      try {
        await updateAllErc20Tokens();
      } catch (error) {
        console.error('❌ Error in updateAllErc20Tokens interval:', error);
      }
    }, VRC20_UPDATE_INTERVAL);

    // LP tokens sync from factory (1 hour interval to detect new pairs)
    const LP_SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour
    setInterval(async () => {
      try {
        await syncLPTokensFromFactory();
      } catch (error) {
        console.error('❌ Error in syncLPTokensFromFactory interval:', error);
      }
    }, LP_SYNC_INTERVAL);

    // Launchpad factories → tokens collection (replaces the former writing GET /api/launchpad/sync)
    setInterval(async () => {
      await runLaunchpadSync();
    }, LAUNCHPAD_SYNC_INTERVAL);
  } catch (error) {
    console.error('💥 Error in main function:', error);
    throw error;
  }
}

export { main };

if (require.main === module) {
  process.on('SIGINT', async () => {
    console.log('🛑 Caught interrupt signal. Shutting down gracefully.');
    await disconnect();
    process.exit(0);
  });
  main().catch(() => process.exit(1));
}
