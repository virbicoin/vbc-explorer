#!/usr/bin/env node
/*
Name: VirBiCoin Blockchain syncer
Description: This file will start syncing the blockchain from the VirBiCoin node
*/

import mongoose from 'mongoose';
import Web3 from 'web3';
import fs from 'fs';
import path from 'path';
import { connectDB, Block, Transaction, Contract } from '../models/index';
import { main as statsMain } from './stats';
import { makeRichList } from './richlist';
import { main as tokensMain } from './tokens';
import { readConfig as loadConfig, getWeb3ProviderURL } from '../lib/config';

// Use unified config loader

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
  } catch (error) {
    console.error('❌ Failed to connect to database:', error);
    process.exit(1);
  }
};

// メモリ監視機能を追加
const checkMemory = () => {
  const usage = process.memoryUsage();
  const usedMB = Math.round(usage.heapUsed / 1024 / 1024);
  const limitMB = parseInt(process.env.MEMORY_LIMIT_MB || '1024'); // Optimized for 2GB instances

  if (usedMB > limitMB) {
    console.log(`⚠️  Memory usage: ${usedMB}MB (limit: ${limitMB}MB)`);
    if (global.gc) {
      global.gc();
      console.log('🧹 Garbage collection executed');
    }
    return false;
  }
  return true;
};

// Utility functions for web3 v4 type conversions
const toNumber = (value: any): number => {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return parseInt(value, 10);
  return Number(value) || 0;
};

const toString = (value: any): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return Web3.utils.bytesToHex(value);
  return String(value);
};

const toBoolean = (value: any): boolean | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value > 0n;
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  return Boolean(value);
};

/**
 * Register a contract in the database
 * Called when a contract creation transaction is detected
 */
const registerContract = async (
  contractAddress: string,
  creatorAddress: string,
  creationTxHash: string,
  blockNumber: number,
  web3Instance: Web3
): Promise<void> => {
  try {
    const normalizedAddress = contractAddress.toLowerCase();

    // Check if contract already exists
    const existing = await Contract.findOne({ address: normalizedAddress });
    if (existing) {
      return; // Already registered
    }

    // Get bytecode to verify it's a contract
    const bytecode = await web3Instance.eth.getCode(contractAddress);
    if (!bytecode || bytecode === '0x' || bytecode === '0x0') {
      return; // Not a contract
    }

    // Token detection results
    let tokenType: 'ERC20' | 'ERC721' | 'ERC1155' | 'Contract' = 'Contract';
    let tokenName = '';
    let tokenSymbol = '';
    let tokenDecimals = 0;

    // ERC-165 interface IDs
    const ERC721_INTERFACE_ID = '0x80ac58cd';
    const ERC1155_INTERFACE_ID = '0xd9b67a26';

    // Try to detect token type
    try {
      // First, check for ERC-165 supportsInterface (for NFTs)
      const erc165ABI = [
        {
          constant: true,
          inputs: [{ name: 'interfaceId', type: 'bytes4' }],
          name: 'supportsInterface',
          outputs: [{ name: '', type: 'bool' }],
          type: 'function',
        },
      ];
      const erc165Contract = new web3Instance.eth.Contract(erc165ABI as any, contractAddress);

      // Check for ERC-721
      try {
        const isERC721 = await erc165Contract.methods.supportsInterface(ERC721_INTERFACE_ID).call();
        if (isERC721) {
          tokenType = 'ERC721';
        }
      } catch {
        // Not ERC-165 compliant or not ERC-721
      }

      // Check for ERC-1155
      if (tokenType === 'Contract') {
        try {
          const isERC1155 = await erc165Contract.methods
            .supportsInterface(ERC1155_INTERFACE_ID)
            .call();
          if (isERC1155) {
            tokenType = 'ERC1155';
          }
        } catch {
          // Not ERC-1155
        }
      }

      // Try ERC-20 detection
      const erc20ABI = [
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
          inputs: [],
          name: 'decimals',
          outputs: [{ name: '', type: 'uint8' }],
          type: 'function',
        },
      ];
      const contract = new web3Instance.eth.Contract(erc20ABI as any, contractAddress);

      // Try to call ERC20 methods
      const [name, symbol, decimals] = await Promise.all([
        contract.methods
          .name()
          .call()
          .catch(() => null),
        contract.methods
          .symbol()
          .call()
          .catch(() => null),
        contract.methods
          .decimals()
          .call()
          .catch(() => null),
      ]);

      if (name && symbol) {
        tokenName = String(name);
        tokenSymbol = String(symbol);
        tokenDecimals = decimals ? Number(decimals) : 18;

        // Only set as ERC20 if not already detected as NFT
        if (tokenType === 'Contract') {
          tokenType = 'ERC20';
        }
      }
    } catch {
      // Not an ERC20 token or method call failed
    }

    // Convert tokenType to ERC number
    const ercNumber =
      tokenType === 'ERC20' ? 2 : tokenType === 'ERC721' ? 721 : tokenType === 'ERC1155' ? 1155 : 0;

    // Create contract entry
    await Contract.create({
      address: normalizedAddress,
      blockNumber: blockNumber,
      ERC: ercNumber,
      type: tokenType === 'Contract' ? null : `VRC-${tokenType.replace('ERC', '')}`,
      creationTransaction: creationTxHash,
      contractName:
        tokenType !== 'Contract' ? tokenName || tokenSymbol || 'Unknown Token' : 'Contract',
      tokenName: tokenName || null,
      symbol: tokenSymbol || null,
      owner: creatorAddress.toLowerCase(),
      decimals: tokenDecimals,
      verified: false,
    });

    const typeLabel =
      tokenType !== 'Contract' ? ` (${tokenType}: ${tokenSymbol || tokenName})` : '';
    console.log(`📝 Contract registered: ${normalizedAddress}${typeLabel}`);
  } catch (error: any) {
    // Ignore duplicate key errors
    if (error.code !== 11000) {
      console.error(`⚠️ Failed to register contract ${contractAddress}:`, error.message);
    }
  }
};

/**
 * Register known contracts from config.json
 */
const registerKnownContracts = async (web3Instance: Web3): Promise<void> => {
  const cfg = config as any;
  const contracts: Array<{
    address: string;
    contractName: string;
    symbol?: string;
    tokenName?: string;
    decimals?: number;
    type: 'contract' | 'token';
  }> = [];

  // DEX Contracts
  if (cfg.dex) {
    if (cfg.dex.factory) {
      contracts.push({
        address: cfg.dex.factory.toLowerCase(),
        contractName: 'SimpleFactoryV2',
        type: 'contract',
      });
    }
    if (cfg.dex.router) {
      contracts.push({
        address: cfg.dex.router.toLowerCase(),
        contractName: 'SimpleRouterV2',
        type: 'contract',
      });
    }
    if (cfg.dex.masterChef) {
      contracts.push({
        address: cfg.dex.masterChef.toLowerCase(),
        contractName: 'MasterChef',
        type: 'contract',
      });
    }
    if (cfg.dex.wrappedNative?.address) {
      contracts.push({
        address: cfg.dex.wrappedNative.address.toLowerCase(),
        contractName: cfg.dex.wrappedNative.name || 'WVBC',
        symbol: cfg.dex.wrappedNative.symbol,
        tokenName: cfg.dex.wrappedNative.name,
        decimals: cfg.dex.wrappedNative.decimals || 18,
        type: 'token',
      });
    }
    if (cfg.dex.rewardToken?.address) {
      contracts.push({
        address: cfg.dex.rewardToken.address.toLowerCase(),
        contractName: cfg.dex.rewardToken.name || 'Reward Token',
        symbol: cfg.dex.rewardToken.symbol,
        tokenName: cfg.dex.rewardToken.name,
        decimals: cfg.dex.rewardToken.decimals || 18,
        type: 'token',
      });
    }
    // DEX Tokens
    if (cfg.dex.tokens) {
      for (const [, token] of Object.entries(cfg.dex.tokens)) {
        const t = token as any;
        if (t.address) {
          contracts.push({
            address: t.address.toLowerCase(),
            contractName: t.name || 'Token',
            symbol: t.symbol,
            tokenName: t.name,
            decimals: t.decimals || 18,
            type: 'token',
          });
        }
      }
    }
    // LP Tokens
    if (cfg.dex.lpTokens) {
      for (const [, lp] of Object.entries(cfg.dex.lpTokens)) {
        const l = lp as any;
        if (l.address) {
          contracts.push({
            address: l.address.toLowerCase(),
            contractName: l.name || 'LP Token',
            symbol: l.symbol,
            tokenName: l.name,
            type: 'token',
          });
        }
      }
    }
  }

  // Launchpad TokenFactory
  if (cfg.launchpad?.factoryAddress) {
    contracts.push({
      address: cfg.launchpad.factoryAddress.toLowerCase(),
      contractName: 'TokenFactory',
      type: 'contract',
    });
  }

  if (contracts.length === 0) return;

  console.log(`📋 Registering ${contracts.length} known contracts from config.json...`);

  for (const contract of contracts) {
    try {
      const existing = await Contract.findOne({ address: contract.address });
      if (!existing) {
        // Verify it's actually a contract on-chain
        const bytecode = await web3Instance.eth.getCode(contract.address);
        if (bytecode && bytecode !== '0x' && bytecode !== '0x0') {
          await Contract.create({
            address: contract.address,
            contractName: contract.contractName,
            symbol: contract.symbol,
            tokenName: contract.tokenName,
            decimals: contract.decimals,
            ERC: contract.type === 'token' ? 2 : 0,
            verified: false,
          });
          console.log(`  ✅ ${contract.contractName} (${contract.address.slice(0, 10)}...)`);
        }
      }
    } catch (error: any) {
      if (error.code !== 11000) {
        console.error(`  ⚠️ Failed to register ${contract.contractName}:`, error.message);
      }
    }
  }
};

// Interface definitions
interface Config {
  nodeAddr: string;
  port: number;
  wsPort: number;
  bulkSize: number;
  syncAll: boolean;
  patch: boolean;
  quiet: boolean;
  useRichList: boolean;
  startBlock: number;
  endBlock: number | null;
}

interface NormalizedTransaction {
  blockHash: string | null;
  blockNumber: number | null;
  from: string | null;
  hash: string;
  value: string;
  nonce: number;
  gas: number;
  gasUsed: number;
  gasPrice: string;
  input: string;
  transactionIndex: number | null;
  timestamp: number;
  status: boolean | null;
  to?: string;
}

interface BlockDocument {
  number: number;
  hash: string;
  parentHash: string;
  nonce: string;
  sha3Uncles: string;
  logsBloom: string;
  transactionsRoot: string;
  stateRoot: string;
  receiptsRoot: string;
  miner: string | null;
  difficulty: string;
  totalDifficulty: string;
  extraData: string;
  size: number;
  gasLimit: number;
  gasUsed: number;
  timestamp: number;
  transactions: string[];
  uncles: string[];
}

// Generic Configuration
const config = loadConfig();

// Parse command line arguments
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--start':
      if (i + 1 < args.length) {
        config.startBlock = parseInt(args[++i]) || 0;
      }
      break;
    case '--end':
      if (i + 1 < args.length) {
        config.endBlock = parseInt(args[++i]) || null;
      }
      break;
    case '--sync-all':
      config.syncAll = true;
      break;
    case '--quiet':
      config.quiet = true;
      break;
    case '--help':
      console.log(`
Usage: npm run sync [options]

Options:
  --start <block>     Start block number (default: 0)
  --end <block>       End block number (default: latest)
  --sync-all          Force full sync from start block
  --quiet             Reduce console output
  --help              Show this help message

Examples:
  npm run sync                    # Sync from config.json settings
  npm run sync --start 0 --end 1000  # Sync blocks 0-1000
  npm run sync --sync-all        # Force full sync from block 0
      `);
      process.exit(0);
  }
}

// Override config with command line arguments if provided
if (args.length >= 2 && !isNaN(parseInt(args[0])) && !isNaN(parseInt(args[1]))) {
  config.startBlock = parseInt(args[0]);
  config.endBlock = parseInt(args[1]);
  config.syncAll = true;
  console.log(`Command line override: syncing blocks ${config.startBlock} to ${config.endBlock}`);
}

// Use unified Web3 provider URL
const providerUrl = getWeb3ProviderURL();
console.log(`🔌 Connecting to VirBiCoin node at ${providerUrl}...`);

// Web3 connection using unified config
const web3 = new Web3(new Web3.providers.HttpProvider(providerUrl));

/**
 * Normalize transaction data
 */
const normalizeTX = async (
  txData: any, // Using any due to web3 v4 type complexity
  receipt: any | null,
  blockData: any
): Promise<NormalizedTransaction> => {
  const tx: NormalizedTransaction = {
    blockHash: toString(txData.blockHash || blockData.hash),
    blockNumber: toNumber(txData.blockNumber || blockData.number),
    from: txData.from ? toString(txData.from).toLowerCase() : null,
    hash: toString(txData.hash).toLowerCase(),
    value: toString(txData.value || '0'),
    nonce: toNumber(txData.nonce),
    gas: toNumber(txData.gas),
    gasUsed: receipt ? toNumber(receipt.gasUsed) : 0,
    gasPrice: toString(txData.gasPrice || '0'),
    input: toString(txData.input || txData.data || '0x'),
    transactionIndex: toNumber(txData.transactionIndex),
    timestamp: toNumber(blockData.timestamp),
    status: receipt ? toBoolean(receipt.status) : null,
  };

  if (txData.to) {
    tx.to = toString(txData.to).toLowerCase();
  }

  return tx;
};

/**
 * Write block to database with improved performance
 */
interface WriteBlockToDB {
  (blockData: any | null, flush?: boolean): Promise<void>;
  bulkOps?: BlockDocument[];
}

const writeBlockToDB: WriteBlockToDB = async function (
  blockData: any | null,
  flush = false
): Promise<void> {
  const self = writeBlockToDB;
  if (!self.bulkOps) {
    self.bulkOps = [];
  }

  if (blockData && toNumber(blockData.number) >= 0) {
    const blockDoc: BlockDocument = {
      number: toNumber(blockData.number),
      hash: toString(blockData.hash),
      parentHash: toString(blockData.parentHash),
      nonce: toString(blockData.nonce),
      sha3Uncles: toString(blockData.sha3Uncles),
      logsBloom: toString(blockData.logsBloom),
      transactionsRoot: toString(blockData.transactionsRoot),
      stateRoot: toString(blockData.stateRoot),
      receiptsRoot: toString(blockData.receiptsRoot),
      miner: blockData.miner ? toString(blockData.miner).toLowerCase() : null,
      difficulty: toString(blockData.difficulty),
      totalDifficulty: toString(blockData.totalDifficulty),
      extraData: toString(blockData.extraData),
      size: toNumber(blockData.size),
      gasLimit: toNumber(blockData.gasLimit),
      gasUsed: toNumber(blockData.gasUsed),
      timestamp: toNumber(blockData.timestamp),
      transactions: blockData.transactions.map((tx: any) =>
        typeof tx === 'string' ? tx : toString(tx.hash)
      ),
      uncles: blockData.uncles || [],
    };

    self.bulkOps.push(blockDoc);

    if (!config.quiet) {
      console.log(`🔄 block #${blockData.number} prepared for insertion.`);
    }
  }

  if ((flush && self.bulkOps.length > 0) || self.bulkOps.length >= config.bulkSize) {
    const bulk = self.bulkOps;
    self.bulkOps = [];

    if (bulk.length === 0) return;

    // Use upsert to avoid duplicates
    for (const block of bulk) {
      try {
        await Block.updateOne({ number: block.number }, { $set: block }, { upsert: true });
      } catch (err) {
        console.log(`Error: Failed to upsert block #${block.number}: ${err}`);
      }
    }
    if (!config.quiet) {
      console.log(`✅ ${bulk.length} blocks upserted.`);
    }
  }
};

/**
 * Write transactions to database with improved performance
 */
interface WriteTransactionsToDB {
  (blockData: any | null, flush?: boolean): Promise<void>;
  bulkOps?: NormalizedTransaction[];
  blocks?: number;
}

const writeTransactionsToDB: WriteTransactionsToDB = async function (
  blockData: any | null,
  flush = false
): Promise<void> {
  const self = writeTransactionsToDB;
  if (!self.bulkOps) {
    self.bulkOps = [];
    self.blocks = 0;
  }

  if (blockData && blockData.transactions.length > 0) {
    for (const txData of blockData.transactions) {
      if (typeof txData === 'string') continue; // Skip if only hash

      try {
        const receipt = await web3.eth.getTransactionReceipt(toString(txData.hash));
        const tx = await normalizeTX(txData, receipt, blockData);
        self.bulkOps.push(tx);

        // Detect contract creation and auto-register
        if (receipt && receipt.contractAddress) {
          const contractAddr = toString(receipt.contractAddress);
          const creatorAddr = toString(txData.from);
          const txHash = toString(txData.hash);
          const blockNum = toNumber(blockData.number);

          // Register contract asynchronously (don't wait)
          registerContract(contractAddr, creatorAddr, txHash, blockNum, web3).catch(() => {});
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(
          `⚠️ Warning: Failed to get receipt for tx ${toString(txData.hash)}: ${errorMessage}`
        );
      }
    }

    if (!config.quiet) {
      console.log(
        `💾 block #${blockData.number}: ${blockData.transactions.length} transactions recorded.`
      );
    }
  }

  self.blocks = (self.blocks || 0) + 1;

  if ((flush && (self.blocks || 0) > 0) || (self.bulkOps?.length || 0) >= config.bulkSize) {
    const bulk = self.bulkOps || [];
    self.bulkOps = [];
    self.blocks = 0;

    if (bulk.length === 0) return;

    // Insert transactions
    try {
      const docs = await Transaction.insertMany(bulk, { ordered: false });
      if (!config.quiet) {
        console.log(`✅ ${docs.length} transactions successfully recorded.`);
      }
    } catch (err: any) {
      if (err.code === 11000) {
        if (!config.quiet) {
          console.log('Skip: Duplicate transaction keys detected');
        }
      } else {
        console.log(`❌ Error: Failed to insert transactions: ${err}`);
        process.exit(9);
      }
    }
  }
};

/**
 * Listen for new blocks (real-time sync) with improved performance
 */
const listenBlocks = function (): void {
  console.log('🚀 Starting real-time block listener...');

  const pollInterval = 5000; // Poll every 5 seconds (3秒→5秒に延長)
  let lastProcessedBlock = 0;
  let isProcessing = false; // 重複処理を防ぐフラグ

  const poll = async (): Promise<void> => {
    if (isProcessing) {
      return; // 既に処理中の場合はスキップ
    }

    try {
      isProcessing = true;
      const currentBlockBigInt = await web3.eth.getBlockNumber();
      const currentBlock = toNumber(currentBlockBigInt);

      if (currentBlock > lastProcessedBlock) {
        console.log(`🔍 New block detected: ${currentBlock} (last: ${lastProcessedBlock})`);

        // Process new blocks in batches
        const blocksToProcess = Math.min(currentBlock - lastProcessedBlock, 5); // Reduced from 10 to 5

        for (let i = 0; i < blocksToProcess; i++) {
          const blockNum = lastProcessedBlock + 1 + i;

          try {
            const blockData = await web3.eth.getBlock(blockNum, true);

            if (blockData) {
              // Check if block already exists to avoid duplicates with extended timeout
              const existingBlock = await Block.findOne({ number: blockNum })
                .lean()
                .maxTimeMS(60000);

              if (!existingBlock) {
                await writeBlockToDB(blockData, true);
                await writeTransactionsToDB(blockData, true);
                console.log(
                  `📦 Processed new block: ${blockNum} (${blockData.transactions.length} transactions)`
                );
              } else {
                console.log(`⏭️ Block ${blockNum} already exists, skipping`);
              }
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            // If timeout error, wait and continue - don't fail
            if (errorMessage.includes('time limit') || errorMessage.includes('timeout')) {
              console.log(`⏳ Block ${blockNum} query timeout, will retry later`);
              await new Promise((resolve) => setTimeout(resolve, 5000));
            } else {
              console.log(`❌ Error processing block ${blockNum}: ${errorMessage}`);
            }
          }
        }

        lastProcessedBlock = currentBlock;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`Error polling for blocks: ${errorMessage}`);
    } finally {
      isProcessing = false;
    }
  };

  // Get initial block number
  web3.eth
    .getBlockNumber()
    .then((blockNumberBigInt) => {
      lastProcessedBlock = toNumber(blockNumberBigInt);
      console.log(`🔍 Real-time listener starting from block: ${lastProcessedBlock}`);

      // Start polling
      setInterval(poll, pollInterval);
    })
    .catch((err) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.log(`Error getting initial block number: ${errorMessage}`);
    });
};

/**
 * Sync chain from specific block range with improved performance and parallel processing
 */
const syncChain = async function (startBlock?: number, endBlock?: number): Promise<void> {
  // Use config values if not provided
  if (!startBlock) {
    startBlock = config.startBlock;
  }
  if (!endBlock) {
    const latestBlockBigInt = await web3.eth.getBlockNumber();
    endBlock = config.endBlock
      ? Math.min(config.endBlock, toNumber(latestBlockBigInt))
      : toNumber(latestBlockBigInt);
  }

  console.log(`🔄 Syncing blocks from ${startBlock} to ${endBlock}...`);

  // Check which blocks already exist in database with timeout
  const existingBlocks = await Block.find({
    number: { $gte: startBlock, $lte: endBlock },
  })
    .select('number')
    .lean()
    .maxTimeMS(120000);

  const existingBlockNumbers = new Set(existingBlocks.map((b) => b.number));
  console.log(
    `🔍 Found ${existingBlocks.length} existing blocks in range ${startBlock}-${endBlock}`
  );

  let processedCount = 0;
  let skippedCount = 0;
  const BATCH_SIZE = Math.min(config.bulkSize, 50); // Reduced for 2GB instances
  const CONCURRENCY_LIMIT = 3; // Reduced concurrent block fetches for low memory

  // Process blocks in parallel batches
  for (let batchStart = startBlock; batchStart <= endBlock; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, endBlock);
    const batchNumbers = [];

    // Collect block numbers that need processing
    for (let blockNum = batchStart; blockNum <= batchEnd; blockNum++) {
      if (!existingBlockNumbers.has(blockNum)) {
        batchNumbers.push(blockNum);
      } else {
        skippedCount++;
      }
    }

    if (batchNumbers.length === 0) {
      continue; // Skip this batch if all blocks exist
    }

    console.log(
      `🚀 Processing batch ${batchStart}-${batchEnd} (${batchNumbers.length} new blocks)`
    );

    try {
      // Process blocks in smaller chunks to avoid overwhelming the node
      const chunks = [];
      for (let i = 0; i < batchNumbers.length; i += CONCURRENCY_LIMIT) {
        chunks.push(batchNumbers.slice(i, i + CONCURRENCY_LIMIT));
      }

      const allBlocksData = [];

      for (const chunk of chunks) {
        // Fetch blocks in parallel within each chunk
        const blockPromises = chunk.map(async (blockNum) => {
          try {
            const blockData = await web3.eth.getBlock(blockNum, true);
            return { blockNum, blockData };
          } catch (error) {
            console.log(`❌ Error fetching block ${blockNum}: ${error}`);
            return { blockNum, blockData: null };
          }
        });

        const chunkResults = await Promise.all(blockPromises);
        allBlocksData.push(...chunkResults);

        // Small delay between chunks to prevent overwhelming the node
        if (chunks.length > 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      // Batch write to database
      const blocksToInsert = [];
      const transactionsToInsert = [];

      for (const { blockNum, blockData } of allBlocksData) {
        if (blockData) {
          // Prepare block data for insertion
          const blockDoc = {
            number: toNumber(blockData.number),
            hash: toString(blockData.hash),
            parentHash: toString(blockData.parentHash),
            nonce: toString(blockData.nonce),
            sha3Uncles: toString(blockData.sha3Uncles),
            logsBloom: toString(blockData.logsBloom),
            transactionsRoot: toString(blockData.transactionsRoot),
            stateRoot: toString(blockData.stateRoot),
            receiptsRoot: toString(blockData.receiptsRoot),
            miner: toString(blockData.miner),
            difficulty: toString(blockData.difficulty),
            totalDifficulty: toString(blockData.totalDifficulty),
            extraData: toString(blockData.extraData),
            size: toNumber(blockData.size),
            gasLimit: toNumber(blockData.gasLimit),
            gasUsed: toNumber(blockData.gasUsed),
            timestamp: toNumber(blockData.timestamp),
            transactions: blockData.transactions
              ? blockData.transactions.map((tx: any) => toString(tx.hash || tx))
              : [],
            uncles: blockData.uncles || [],
            baseFeePerGas: blockData.baseFeePerGas ? toString(blockData.baseFeePerGas) : undefined,
            mixHash: blockData.mixHash ? toString(blockData.mixHash) : undefined,
            withdrawals: (blockData as any).withdrawals || [],
            withdrawalsRoot: (blockData as any).withdrawalsRoot
              ? toString((blockData as any).withdrawalsRoot)
              : undefined,
            blobGasUsed: (blockData as any).blobGasUsed
              ? toNumber((blockData as any).blobGasUsed)
              : undefined,
            excessBlobGas: (blockData as any).excessBlobGas
              ? toNumber((blockData as any).excessBlobGas)
              : undefined,
            parentBeaconBlockRoot: (blockData as any).parentBeaconBlockRoot
              ? toString((blockData as any).parentBeaconBlockRoot)
              : undefined,
          };

          blocksToInsert.push(blockDoc);

          // Process transactions if they exist and are detailed
          if (blockData.transactions && Array.isArray(blockData.transactions)) {
            // Get transaction receipts in parallel for gas usage and status
            const receiptPromises = blockData.transactions
              .filter((tx: any) => typeof tx === 'object' && tx !== null)
              .map(async (tx: any) => {
                try {
                  const receipt = await web3.eth.getTransactionReceipt(toString(tx.hash));
                  return { tx, receipt };
                } catch (error) {
                  console.log(
                    `⚠️ Warning: Failed to get receipt for tx ${toString(tx.hash)}: ${error}`
                  );
                  return { tx, receipt: null };
                }
              });

            const txReceiptPairs = await Promise.all(receiptPromises);

            for (const { tx, receipt } of txReceiptPairs) {
              const txDoc = {
                hash: toString(tx.hash),
                nonce: toNumber(tx.nonce),
                blockHash: toString(tx.blockHash),
                blockNumber: toNumber(tx.blockNumber),
                transactionIndex: toNumber(tx.transactionIndex),
                from: toString(tx.from),
                to: tx.to ? toString(tx.to) : null,
                value: toString(tx.value),
                gasPrice: tx.gasPrice ? toString(tx.gasPrice) : null,
                gas: toNumber(tx.gas),
                gasUsed: receipt ? toNumber(receipt.gasUsed) : 0, // Add gasUsed from receipt
                status: receipt ? (receipt.status ? 1 : 0) : null, // Add status from receipt
                input: toString(tx.input),
                timestamp: toNumber(blockData.timestamp), // Add block timestamp to transaction
                creates: (tx as any).creates ? toString((tx as any).creates) : null,
                raw: (tx as any).raw ? toString((tx as any).raw) : null,
                publicKey: (tx as any).publicKey ? toString((tx as any).publicKey) : null,
                r: tx.r ? toString(tx.r) : null,
                s: tx.s ? toString(tx.s) : null,
                v: tx.v ? toString(tx.v) : null,
                standardV: (tx as any).standardV ? toString((tx as any).standardV) : null,
                type: tx.type !== undefined ? toNumber(tx.type) : null,
                accessList: tx.accessList || [],
                chainId: tx.chainId ? toNumber(tx.chainId) : null,
                maxFeePerGas: tx.maxFeePerGas ? toString(tx.maxFeePerGas) : null,
                maxPriorityFeePerGas: tx.maxPriorityFeePerGas
                  ? toString(tx.maxPriorityFeePerGas)
                  : null,
                maxFeePerBlobGas: (tx as any).maxFeePerBlobGas
                  ? toString((tx as any).maxFeePerBlobGas)
                  : null,
                blobVersionedHashes: (tx as any).blobVersionedHashes || [],
                yParity: (tx as any).yParity ? toString((tx as any).yParity) : null,
              };
              transactionsToInsert.push(txDoc);

              // Detect contract creation and auto-register
              if (receipt && receipt.contractAddress) {
                const contractAddr = toString(receipt.contractAddress);
                const creatorAddr = toString(tx.from);
                const txHash = toString(tx.hash);
                const blockNum = toNumber(blockData.number);

                // Register contract asynchronously (don't block sync)
                registerContract(contractAddr, creatorAddr, txHash, blockNum, web3).catch(() => {});
              }
            }
          }
          processedCount++;
        }
      }

      // Bulk insert blocks and transactions
      try {
        if (blocksToInsert.length > 0) {
          await Block.insertMany(blocksToInsert, { ordered: false });
        }
        if (transactionsToInsert.length > 0) {
          await Transaction.insertMany(transactionsToInsert, { ordered: false });
        }
      } catch (error) {
        // Handle duplicate key errors gracefully
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!errorMessage.includes('duplicate key') && !errorMessage.includes('E11000')) {
          console.log(`❌ Database error: ${errorMessage}`);
        }
      }

      // Memory check and GC
      if (!checkMemory()) {
        console.log('💾 Memory limit reached, forcing garbage collection');
        if (global.gc) {
          global.gc();
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // Progress logging
      const progress = (((batchEnd - startBlock + 1) / (endBlock - startBlock + 1)) * 100).toFixed(
        1
      );
      console.log(
        `📦 Batch completed: ${batchStart}-${batchEnd} | Progress: ${progress}% | Processed: ${processedCount}, Skipped: ${skippedCount}`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`❌ Error processing batch ${batchStart}-${batchEnd}: ${errorMessage}`);
    }
  }

  console.log(`✅ Sync Completed`);
  console.log(`📊 Processed: ${processedCount} blocks`);
  console.log(`⏩ Skipped: ${skippedCount} existing blocks`);
};

/**
 * Check database and prepare sync
 */
const prepareSync = async (): Promise<void> => {
  try {
    // Find the latest block in database
    const latestBlockDoc = await Block.findOne({}, { number: 1 })
      .sort({ number: -1 })
      .maxTimeMS(60000);

    if (latestBlockDoc) {
      const dbLatestBlock = latestBlockDoc.number;
      const nodeLatestBlockBigInt = await web3.eth.getBlockNumber();
      const nodeLatestBlock = toNumber(nodeLatestBlockBigInt);

      console.log(`📊 Database latest block: ${dbLatestBlock}`);
      console.log(`📊 Node latest block: ${nodeLatestBlock}`);

      if (nodeLatestBlock > dbLatestBlock) {
        console.log(`📚 Syncing missing blocks: ${dbLatestBlock + 1} to ${nodeLatestBlock}`);
        await syncChain(dbLatestBlock + 1, nodeLatestBlock);
      } else {
        console.log('✅ Database is up to date');
      }
    } else {
      console.log('📚 No blocks found in database, starting initial sync...');
      // Use config values for initial sync
      await syncChain(config.startBlock, config.endBlock || undefined);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`❌ Error in prepareSync: ${errorMessage}`);
  }
};

/**
 * Hybrid sync: Catch latest blocks while syncing past blocks
 */
const hybridSync = async (): Promise<void> => {
  try {
    // Start real-time listener for latest blocks
    console.log('🚀 Starting real-time block listener for latest blocks...');
    listenBlocks();

    // Start background sync for past blocks
    console.log('📚 Starting background sync for past blocks...');
    await prepareSync();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`❌ Error in hybrid sync: ${errorMessage}`);
  }
};

/**
 * Main execution with improved performance
 */
const main = async (): Promise<void> => {
  try {
    // Load config.json, fallback to config.example.json & set MONGODB_URI
    try {
      const configPath = path.join(__dirname, '..', 'config.json');
      if (fs.existsSync(configPath)) {
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        Object.assign(config, configData);
        console.log('📄 config.json found.');
        if (configData.database && configData.database.uri) {
          process.env.MONGODB_URI = configData.database.uri;
          console.log('📄 MongoDB URI set from config.json');
        }
      } else {
        // Fallback to config.example.json
        const exampleConfigPath = path.join(__dirname, '..', 'config.example.json');
        if (fs.existsSync(exampleConfigPath)) {
          const configData = JSON.parse(fs.readFileSync(exampleConfigPath, 'utf8'));
          Object.assign(config, configData);
          console.log('📄 config.example.json found (fallback).');
          if (configData.database && configData.database.uri) {
            process.env.MONGODB_URI = configData.database.uri;
            console.log('📄 MongoDB URI set from config.example.json');
          }
        } else {
          console.log('📄 No config files found. Using default configuration...');
        }
      }
    } catch (error) {
      console.log('📄 Error reading config files. Using default configuration...');
    }

    // Initialize database connection ONCE
    await initDB();

    // Register known contracts from config.json
    await registerKnownContracts(web3);

    // Test connection by getting latest block number
    try {
      await web3.eth.getBlockNumber();
    } catch (connectionError) {
      console.log('❌ Error: Cannot connect to VirBiCoin node');
      process.exit(1);
    }

    console.log('🔗 Connected to VirBiCoin node successfully');

    // Run initial sync if requested
    if (config.syncAll) {
      console.log('📚 Starting full sync as requested...');
      await syncChain(config.startBlock, config.endBlock || undefined);
      // After full sync, start hybrid mode
      await hybridSync();
    } else {
      // Use hybrid sync by default
      await hybridSync();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if it's a timeout error - these are recoverable
    if (errorMessage.includes('timed out') || errorMessage.includes('timeout')) {
      console.log(`⌛ Timeout error occurred: ${errorMessage}`);
      console.log('⌛ Waiting 60 seconds before retry...');
      await new Promise((resolve) => setTimeout(resolve, 60000));
      // Don't exit - let PM2 restart the process
      console.log('🔄 Restarting sync process...');
      return main();
    }

    console.log(`💥 Fatal error: ${errorMessage}`);
    process.exit(1);
  }
};

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  // Flush any remaining data
  await writeBlockToDB(null, true);
  await writeTransactionsToDB(null, true);
  process.exit(0);
});

// Richlist wrapper function
const runRichlist = async () => {
  console.log('🚀 Starting richlist calculation...');

  // Ensure database connection first
  await initDB();

  const web3 = new Web3(new Web3.providers.HttpProvider(getWeb3ProviderURL()));
  const latestBlock = await web3.eth.getBlockNumber();
  const blockNumber = Number(latestBlock);
  const BATCH_SIZE = 50;

  console.log(`📦 Processing richlist for block ${blockNumber}`);
  await makeRichList(blockNumber, BATCH_SIZE);
};

const runAll = async () => {
  // 最初にデータベース接続を確立
  console.log('🔗 Initializing database connection for all tasks...');
  await initDB();

  // 接続が確立されるまで待機
  let retries = 0;
  const maxRetries = 10;
  while (mongoose.connection.readyState !== 1 && retries < maxRetries) {
    console.log('⌛ Waiting for database connection...');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    retries++;
  }

  if (mongoose.connection.readyState !== 1) {
    console.error('❌ Failed to establish database connection');
    process.exit(1);
  }

  console.log('✅ Database connection established, starting all tasks...');

  // 各mainを順次実行（データベース接続の競合を防ぐ）
  try {
    // まずstatsとrichlistを並行実行
    await Promise.all([statsMain(), runRichlist()]);

    // その後、syncとtokensを実行
    await Promise.all([main(), tokensMain()]);
  } catch (error) {
    console.error('❌ Error in runAll:', error);
  }
};

if (require.main === module) {
  const mode = process.argv[2] || 'sync';
  (async () => {
    switch (mode) {
      case 'sync':
        await main();
        break;
      case 'stats':
        await statsMain();
        break;
      case 'richlist':
        await runRichlist();
        break;
      case 'tokens':
        await tokensMain();
        break;
      case 'all':
        await runAll();
        break;
      default:
        console.log('📖 Usage: node tools/sync.js [sync|stats|richlist|tokens|all]');
        process.exit(1);
    }
  })();
}
