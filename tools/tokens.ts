#!/usr/bin/env node
/// <reference path="../types/human-standard-token-abi.d.ts" />

/*
Name: VirBiCoin Token Scanner
Version: 1.0.0
This file will scan the blockchain for new token contracts and update the database.
*/

import Web3 from 'web3';
import mongoose from 'mongoose';
import humanStandardTokenAbi from 'human-standard-token-abi';
import fs from 'fs';
import path from 'path';

// Import NFT service for ownership calculation
import {
  ZERO_ADDR,
  DEAD_ADDR,
  calculateNftOwnership,
  TokenTransfer,
} from '../lib/services/nft.service';

// Import additional models for token transfers and holders
import '../models/index'; // Ensure all models are loaded

// Define Token schema inline since it's not exported from models/index
const tokenSchema = new mongoose.Schema(
  {
    address: String,
    name: String,
    symbol: String,
    decimals: { type: Number, default: 18 },
    totalSupply: String,
    holders: { type: Number, default: 0 },
    type: String,
    supply: String,
    verified: { type: Boolean, default: false },
  },
  { collection: 'tokens' }
);

const Token = mongoose.models.Token || mongoose.model('Token', tokenSchema);

// Schema for tracking scan progress
const scanProgressSchema = new mongoose.Schema(
  {
    scanType: { type: String, unique: true }, // 'tokens' or 'vrc721'
    lastScannedBlock: { type: Number, default: 0 },
    lastUpdateTime: { type: Date, default: Date.now },
  },
  { collection: 'scan_progress' }
);

const ScanProgress =
  mongoose.models.ScanProgress || mongoose.model('ScanProgress', scanProgressSchema);

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

import { connectDB, Contract } from '../models/index';
import { loadConfig, getWeb3ProviderURL } from '../lib/config';

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
  } catch (error) {
    console.error('❌ Failed to connect to database:', error);
    process.exit(1);
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
const BLOCKS_PER_BATCH = 500; // Further reduced for CPU optimization
const SCAN_INTERVAL_MS = 900000; // 15 minutes (extended for CPU relief)
const BATCH_DELAY_MS = 1000; // Longer delay to reduce CPU load
const MAX_PARALLEL_BLOCKS = 20; // Limit parallel block fetching
const MEMORY_LIMIT_MB = parseInt(process.env.MEMORY_LIMIT_MB || '512'); // Optimized for 2GB instances

const web3 = new Web3(new Web3.providers.HttpProvider(WEB3_PROVIDER_URL));

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

// Improved batch processing with parallel execution and delay (CPU optimized)
const processBatchWithDelay = async (
  batch: any[],
  processor: Function,
  concurrency: number = 1
) => {
  const results = [];

  // Process in smaller chunks for parallel execution
  for (let i = 0; i < batch.length; i += concurrency) {
    const chunk = batch.slice(i, i + concurrency);

    try {
      // Process chunk items in parallel
      const chunkPromises = chunk.map(async (item, index) => {
        try {
          return await processor(item);
        } catch (error) {
          console.error(`❌ Error processing item ${i + index}:`, error);
          return null;
        }
      });

      const chunkResults = await Promise.all(chunkPromises);

      // Filter out null results and add to results
      for (const result of chunkResults) {
        if (result) {
          results.push(result);
        }
      }
    } catch (error) {
      console.error(`❌ Error processing chunk starting at ${i}:`, error);
    }

    // Memory check and delay between chunks
    if (!checkMemory()) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } else if (i + concurrency < batch.length) {
      // Small delay between chunks to prevent overwhelming the node
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS / 10));
    }
  }

  return results;
};

async function isErc20Token(contractAddress: string): Promise<boolean> {
  try {
    const contract = new web3.eth.Contract(humanStandardTokenAbi, contractAddress);
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
    // If name/symbol/decimals fail, it's likely not a standard ERC20 token
    console.log(`❌ isErc20Token check failed for ${contractAddress}: ${error.message}`);
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

// Function to get actual token transfers from blockchain with batching
async function getTokenTransfers(tokenAddress: string, fromBlock: number = 0): Promise<any[]> {
  try {
    console.log(`🔄 Fetching Transfer events for token ${tokenAddress} from block ${fromBlock}...`);

    // Get Transfer events for this token
    const logs = await web3.eth.getPastLogs({
      address: tokenAddress,
      topics: [ERC721_TRANSFER_TOPIC],
      fromBlock: fromBlock,
      toBlock: 'latest',
    });

    console.log(`🔍 Found ${logs.length} Transfer events for token ${tokenAddress}`);

    // Process logs in batches to reduce memory usage
    const batchSize = 100;
    const transfers = [];

    for (let i = 0; i < logs.length; i += batchSize) {
      const batch = logs.slice(i, i + batchSize);

      const batchTransfers = await processBatchWithDelay(batch, async (log: any) => {
        try {
          const block = await web3.eth.getBlock(log.blockNumber);

          // Decode transfer event (from, to, tokenId)
          const from = '0x' + log.topics[1].slice(26); // Remove padding
          const to = '0x' + log.topics[2].slice(26); // Remove padding
          const tokenId = web3.utils.hexToNumber(log.topics[3] || log.data);

          return {
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
            from: from.toLowerCase(),
            to: to.toLowerCase(),
            value: '1', // NFTs have value of 1
            tokenAddress: tokenAddress.toLowerCase(),
            timestamp: new Date(Number(block.timestamp) * 1000),
            tokenId: tokenId,
          };
        } catch (error) {
          console.error(`❌ Error processing transfer log:`, error);
          return null;
        }
      });

      transfers.push(...batchTransfers.filter((t) => t !== null));

      // Memory check and delay between batches
      if (!checkMemory()) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    console.log(
      `✅ Successfully processed ${transfers.length} transfers for token ${tokenAddress}`
    );
    return transfers;
  } catch (error) {
    console.error(`❌ Error getting transfers for token ${tokenAddress}:`, error);
    return [];
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

// Function to get VRC-20 token transfers from blockchain
async function getErc20TokenTransfers(tokenAddress: string, fromBlock: number = 0): Promise<any[]> {
  try {
    console.log(
      `🔄 Fetching VRC-20 Transfer events for token ${tokenAddress} from block ${fromBlock}...`
    );

    // Transfer event signature (same for ERC20 and ERC721)
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

    // Use retry logic for getPastLogs
    const logs = await retryWeb3Call(() =>
      web3.eth.getPastLogs({
        address: tokenAddress,
        topics: [TRANSFER_TOPIC],
        fromBlock: fromBlock,
        toBlock: 'latest',
      })
    );

    console.log(`🔍 Found ${logs.length} Transfer events for VRC-20 token ${tokenAddress}`);

    const transfers = [];
    const batchSize = 50; // Reduced batch size to avoid overwhelming RPC

    for (let i = 0; i < logs.length; i += batchSize) {
      const batch = logs.slice(i, i + batchSize);

      const batchTransfers = await processBatchWithDelay(batch, async (log: any) => {
        try {
          // Use retry logic for getBlock
          const block = await retryWeb3Call(() => web3.eth.getBlock(log.blockNumber));

          // Decode transfer event (from, to in topics, value in data)
          const from = '0x' + log.topics[1].slice(26);
          const to = '0x' + log.topics[2].slice(26);
          // VRC-20 transfers have value in data field
          const value = log.data && log.data !== '0x' ? BigInt(log.data).toString() : '0';

          return {
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
            from: from.toLowerCase(),
            to: to.toLowerCase(),
            value: value,
            tokenAddress: tokenAddress.toLowerCase(),
            timestamp: new Date(Number(block.timestamp) * 1000),
          };
        } catch (error) {
          console.error(`❌ Error processing VRC-20 transfer log:`, error);
          return null;
        }
      });

      transfers.push(...batchTransfers.filter((t) => t !== null));

      // Add delay between batches to reduce RPC load
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (!checkMemory()) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    return transfers;
  } catch (error) {
    console.error(`❌ Error fetching VRC-20 transfers for ${tokenAddress}:`, error);
    return [];
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
async function updateErc20TokenWithRealData(tokenAddress: string) {
  console.log(`🔄 Updating VRC-20 token ${tokenAddress} with real blockchain data...`);

  try {
    const transfers = await getErc20TokenTransfers(tokenAddress);
    console.log(`🔍 Found ${transfers.length} transfers for VRC-20 token ${tokenAddress}`);

    if (transfers.length === 0) {
      console.log(`📊 No transfers found for VRC-20 token ${tokenAddress}`);
      return;
    }

    const holders = await calculateErc20TokenHolders(transfers, tokenAddress);
    console.log(`📈 Calculated ${holders.length} holders for VRC-20 token ${tokenAddress}`);

    await connectDB();

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection not established');
    }

    // Upsert transfers in batches
    const transferBatchSize = 200;
    for (let i = 0; i < transfers.length; i += transferBatchSize) {
      const batch = transfers.slice(i, i + transferBatchSize);

      const bulkOps = batch.map((transfer) => ({
        updateOne: {
          filter: {
            transactionHash: transfer.transactionHash,
            tokenAddress: transfer.tokenAddress,
          },
          update: { $set: transfer },
          upsert: true,
        },
      }));

      await db.collection('tokentransfers').bulkWrite(bulkOps);
    }
    console.log(`✅ Upserted ${transfers.length} VRC-20 transfers`);

    // Upsert holders in batches
    const holderBatchSize = 200;
    for (let i = 0; i < holders.length; i += holderBatchSize) {
      const batch = holders.slice(i, i + holderBatchSize);

      const bulkOps = batch.map((holder) => ({
        updateOne: {
          filter: { tokenAddress: holder.tokenAddress, holderAddress: holder.holderAddress },
          update: { $set: holder },
          upsert: true,
        },
      }));

      await db.collection('tokenholders').bulkWrite(bulkOps);
    }
    console.log(`✅ Upserted ${holders.length} VRC-20 holders`);

    // Remove old holders not in the latest set
    const holderAddresses = holders.map((h) => h.holderAddress);
    await db.collection('tokenholders').deleteMany({
      tokenAddress: tokenAddress.toLowerCase(),
      holderAddress: { $nin: holderAddresses },
    });

    // Calculate total supply from balances
    const totalSupply = holders.reduce((sum, h) => sum + BigInt(h.balance), 0n);

    // Update token record
    await db.collection('tokens').updateOne(
      { address: tokenAddress.toLowerCase() },
      {
        $set: {
          supply: totalSupply.toString(),
          totalSupply: totalSupply.toString(),
          holders: holders.length,
          updatedAt: new Date(),
        },
      }
    );

    console.log(
      `✅ Updated VRC-20 token ${tokenAddress}: supply=${totalSupply.toString()}, holders=${holders.length}`
    );
  } catch (error) {
    console.error(`❌ Error updating VRC-20 token ${tokenAddress}:`, error);
  }
}

// 全VRC-20トークンを一括で更新する関数（LPトークン含む）
async function updateAllErc20Tokens() {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.log('🔌 Reconnecting to database for VRC-20 update...');
      await connectDB();
    }

    // VRC-20 tokens and LP tokens (LP tokens use same transfer format as ERC20)
    const tokens = await Token.find({ type: { $in: ['VRC-20', 'ERC20', 'LP', 'SLP', 'SLP-V2', 'UNI-V2', 'CAKE-LP'] } });
    console.log(`💰 Found ${tokens.length} VRC-20/LP tokens to update`);

    // Process tokens sequentially to avoid overwhelming the RPC
    for (const token of tokens) {
      try {
        await updateErc20TokenWithRealData(token.address);
        // Delay between tokens
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`❌ Error updating VRC-20 token ${token.address}:`, error);
      }

      if (!checkMemory()) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    console.log(`✅ Finished updating all VRC-20 tokens`);
  } catch (error) {
    console.error('❌ Error in updateAllErc20Tokens:', error);
  }
}

// Function to update token data with real blockchain data
async function updateTokenWithRealData(tokenAddress: string) {
  console.log(`🔄 Updating token ${tokenAddress} with real blockchain data...`);

  try {
    // Get actual transfers from blockchain
    const transfers = await getTokenTransfers(tokenAddress);
    console.log(`🔍 Found ${transfers.length} transfers for token ${tokenAddress}`);

    if (transfers.length === 0) {
      console.log(`📊 No transfers found for token ${tokenAddress}`);
      return;
    }

    // Calculate holders from transfers
    const holders = await calculateTokenHolders(transfers);
    console.log(`📈 Calculated ${holders.length} holders for token ${tokenAddress}`);

    // Connect to database
    await connectDB();

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection not established');
    }

    console.log('🔗 Database connection confirmed');

    // Upsert real transfers in batches
    // Note: For NFTs, use tokenAddress + tokenId + blockNumber as unique key
    // because one transaction can have multiple Transfer events (e.g., batch mint)
    const transferBatchSize = 200;
    for (let i = 0; i < transfers.length; i += transferBatchSize) {
      const batch = transfers.slice(i, i + transferBatchSize);

      const bulkOps = batch.map((transfer) => ({
        updateOne: {
          filter: {
            tokenAddress: transfer.tokenAddress,
            tokenId: transfer.tokenId,
            blockNumber: transfer.blockNumber,
            to: transfer.to, // Include 'to' to distinguish mint/burn/transfer of same tokenId in same block
          },
          update: { $set: transfer },
          upsert: true,
        },
      }));

      await db.collection('tokentransfers').bulkWrite(bulkOps);

      // Memory check between batches
      if (!checkMemory()) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    console.log(`✅ Upserted ${transfers.length} real transfers`);

    // Remove old transfers not in the latest set
    // Create a unique key set from current transfers
    const currentTransferKeys = new Set(
      transfers.map((t) => `${t.tokenId}-${t.blockNumber}-${t.to}`)
    );

    // Find and remove transfers that are no longer valid
    const existingTransfers = await db
      .collection('tokentransfers')
      .find({
        tokenAddress: tokenAddress.toLowerCase(),
      })
      .toArray();

    const transfersToDelete = existingTransfers.filter((t) => {
      const key = `${t.tokenId}-${t.blockNumber}-${t.to}`;
      return !currentTransferKeys.has(key);
    });

    if (transfersToDelete.length > 0) {
      const idsToDelete = transfersToDelete.map((t) => t._id);
      await db.collection('tokentransfers').deleteMany({
        _id: { $in: idsToDelete },
      });
      console.log(`🗑️ Removed ${transfersToDelete.length} outdated transfers`);
    }

    // Upsert real holders in batches
    const holderBatchSize = 200;
    for (let i = 0; i < holders.length; i += holderBatchSize) {
      const batch = holders.slice(i, i + holderBatchSize);

      const bulkOps = batch.map((holder) => ({
        updateOne: {
          filter: { tokenAddress: holder.tokenAddress, holderAddress: holder.holderAddress },
          update: { $set: holder },
          upsert: true,
        },
      }));

      await db.collection('tokenholders').bulkWrite(bulkOps);

      // Memory check between batches
      if (!checkMemory()) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    console.log(`✅ Upserted ${holders.length} real holders`);

    // Remove old holders not in the latest set
    const holderAddresses = holders.map((h) => h.holderAddress);
    await db.collection('tokenholders').deleteMany({
      tokenAddress: tokenAddress.toLowerCase(),
      holderAddress: { $nin: holderAddresses },
    });

    // Update token total supply based on mints
    const mints = transfers.filter((t) => t.from === '0x0000000000000000000000000000000000000000');
    console.log(`🔍 Found ${mints.length} mint transactions for token ${tokenAddress}`);

    await db.collection('tokens').updateOne(
      { address: tokenAddress.toLowerCase() },
      {
        $set: {
          supply: mints.length.toString(),
          totalSupply: mints.length.toString(),
          holders: holders.length,
          updatedAt: new Date(),
        },
      }
    );

    console.log(
      `✅ Updated token ${tokenAddress}: supply=${mints.length}, holders=${holders.length}, total transfers=${transfers.length}`
    );
  } catch (error) {
    console.error(`❌ Error updating token ${tokenAddress} with real data:`, error);
  }
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

    const latestBlockNumberBigInt = await web3.eth.getBlockNumber();
    const latestBlockNumber = Number(latestBlockNumberBigInt);
    console.log(`🔍 Latest block number: ${latestBlockNumber}`);

    // Only scan new blocks since last scan
    let fromBlock = scanProgress.lastScannedBlock + 1;

    if (fromBlock > latestBlockNumber) {
      console.log(
        `✅ No new blocks to scan. Last scanned: ${scanProgress.lastScannedBlock}, Latest: ${latestBlockNumber}`
      );
      return;
    }

    console.log(
      `🚀 Scanning new blocks from ${fromBlock} to ${latestBlockNumber} (${latestBlockNumber - fromBlock + 1} blocks)`
    );

    while (fromBlock <= latestBlockNumber) {
      const toBlock = Math.min(fromBlock + BLOCKS_PER_BATCH - 1, latestBlockNumber);

      // 5000ブロック単位でログ出力
      if (fromBlock % 5000 === 0) {
        console.log(`🔍 Scanning blocks from ${fromBlock} to ${toBlock}...`);
      }

      // Check which blocks in this range have already been scanned for tokens
      const existingTokens = await Token.find({}).select('address').lean();
      const existingTokenAddresses = new Set(existingTokens.map((t) => t.address.toLowerCase()));

      let newTokensFound = 0;
      let existingTokensSkipped = 0;

      // Process blocks in smaller chunks to reduce memory usage and CPU load
      const blockChunkSize = Math.min(MAX_PARALLEL_BLOCKS, 50); // Limit parallel processing
      for (let chunkStart = fromBlock; chunkStart <= toBlock; chunkStart += blockChunkSize) {
        const chunkEnd = Math.min(chunkStart + blockChunkSize - 1, toBlock);

        // Limit concurrent block fetches to reduce CPU load
        const blockPromises = [];
        for (let i = chunkStart; i <= chunkEnd; i++) {
          blockPromises.push(web3.eth.getBlock(i, true));
        }

        const blocks = await Promise.all(blockPromises);

        // Add delay between chunks to prevent CPU overload
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS / 2));

        for (const block of blocks) {
          if (block && block.transactions) {
            for (const tx of block.transactions) {
              // Check for contract creation transactions
              const txFull = typeof tx === 'string' ? await web3.eth.getTransaction(tx) : tx;
              if (txFull && !txFull.to) {
                const receipt = await web3.eth.getTransactionReceipt(txFull.hash);
                if (receipt && receipt.contractAddress) {
                  const contractAddress = receipt.contractAddress as string;

                  // Skip if token already exists
                  if (existingTokenAddresses.has(contractAddress.toLowerCase())) {
                    existingTokensSkipped++;
                    continue;
                  }

                  console.log(
                    `🏗️ Potential contract found at address: ${contractAddress} in block ${block.number}`
                  );

                  // Check if it's an ERC20 token
                  if (await isErc20Token(contractAddress)) {
                    // Check if token already exists in DB
                    const existingToken = await Token.findOne({
                      address: contractAddress.toLowerCase(),
                    }).lean();

                    if (existingToken) {
                      console.log(
                        `⏭️ Skipping existing ERC20 token: ${contractAddress} (already in DB)`
                      );
                      continue;
                    }

                    const contract = new web3.eth.Contract(humanStandardTokenAbi, contractAddress);
                    const name = (await contract.methods.name().call()) as string;
                    const symbol = (await contract.methods.symbol().call()) as string;
                    const decimals = (await contract.methods.decimals().call()) as bigint;

                    // totalSupply might fail due to EVM opcode issues, default to 0
                    let totalSupply: bigint = 0n;
                    try {
                      totalSupply = (await contract.methods.totalSupply().call()) as bigint;
                    } catch (supplyError: any) {
                      console.log(
                        `⚠️ Could not get totalSupply for ${name}: ${supplyError.message}`
                      );
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
                          decimals: Number(decimals),
                          totalSupply: Number(totalSupply),
                          ERC: 2, // ERC20 = 2
                          verified: false,
                          blockNumber: block.number,
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

                    newTokensFound++;
                    existingTokenAddresses.add(contractAddress.toLowerCase());
                  } else if (await isErc721Token(contractAddress)) {
                    console.log(
                      `🎨 Contract ${contractAddress} is a VRC-721 (ERC721 Compatible) token.`
                    );

                    // Check if token already exists in DB
                    const existingToken = await Token.findOne({
                      address: contractAddress.toLowerCase(),
                    }).lean();

                    if (existingToken) {
                      console.log(
                        `⏭️ Skipping existing VRC-721 token: ${contractAddress} (already in DB)`
                      );
                      continue;
                    }

                    const tokenContract = new web3.eth.Contract(
                      minimalErc721Abi as any,
                      contractAddress
                    );
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
                            decimals: 0,
                            totalSupply: 0,
                            ERC: 3, // VRC-721 = 3 (similar to ERC721)
                            verified: false,
                            blockNumber: block.number,
                          });
                          await newContract.save();
                          console.log(
                            `📝 Added VRC-721 contract ${contractAddress} to Contract collection`
                          );
                        }
                      } catch (contractError) {
                        console.warn(
                          `⚠️ Failed to add VRC-721 contract ${contractAddress} to Contract collection:`,
                          contractError
                        );
                      }

                      newTokensFound++;
                      existingTokenAddresses.add(contractAddress.toLowerCase());
                    } catch (e) {
                      console.error(
                        `❌ Error fetching details for VRC-721 token ${contractAddress}:`,
                        e
                      );
                      continue;
                    }
                  }
                }
              }
            }
          }
        }

        // Memory check and delay between chunks (enhanced for CPU optimization)
        if (!checkMemory()) {
          console.log('🧹 Memory limit reached, forcing cleanup...');
          if (global.gc) {
            global.gc();
          }
          // Longer delay when memory is high
          await new Promise((resolve) => setTimeout(resolve, 3000));
        } else {
          // Regular CPU relief delay
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      // 5000ブロック単位でログ出力
      if (fromBlock % 5000 === 0) {
        console.log(
          `📊 Block range ${fromBlock}-${toBlock}: Found ${newTokensFound} new tokens, skipped ${existingTokensSkipped} existing tokens`
        );
        console.log(`📈 Processed ${fromBlock} blocks for token scanning`);
      }

      fromBlock = toBlock + 1;

      // Update scan progress periodically
      await ScanProgress.updateOne(
        { scanType: 'tokens' },
        {
          lastScannedBlock: toBlock,
          lastUpdateTime: new Date(),
        },
        { upsert: true }
      );

      // Add delay between batches to reduce CPU usage
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }

    // Final update of scan progress
    await ScanProgress.updateOne(
      { scanType: 'tokens' },
      {
        lastScannedBlock: latestBlockNumber,
        lastUpdateTime: new Date(),
      },
      { upsert: true }
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

// 全VRC-721トークンを一括で更新する関数（バッチ処理で最適化）
async function updateAllVrc721Tokens() {
  try {
    // Ensure DB connection
    if (mongoose.connection.readyState !== 1) {
      console.log('🔌 Reconnecting to database for VRC-721 update...');
      await connectDB();
    }

    const tokens = await Token.find({ type: { $in: ['VRC-721', 'ERC721', 'VRC721'] } });
    console.log(`🎨 Found ${tokens.length} VRC-721 tokens to update`);

    // Process tokens in batches
    const batchSize = 10;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);

      const promises = batch.map(async (token) => {
        try {
          await updateTokenWithRealData(token.address);
        } catch (error) {
          console.error(`❌ Error updating token ${token.address}:`, error);
        }
      });

      await Promise.all(promises);

      // Memory check and delay between batches
      if (!checkMemory()) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      // Add delay between batches
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
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
  { inputs: [], name: 'name', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ name: '', type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalSupply', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'token0', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'token1', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
];

// ERC20 ABI for getting token symbol
const ERC20_BASIC_ABI = [
  { inputs: [], name: 'symbol', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'name', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
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
      token0Contract.methods.symbol().call().catch(() => 'UNKNOWN'),
      token1Contract.methods.symbol().call().catch(() => 'UNKNOWN'),
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
    
    if (!factoryAddress) {
      console.log('⚠️ No DEX factory address configured, skipping LP token sync');
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

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection not established');
    }

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
            await Token.updateOne(
              { address: normalizedAddress },
              { $set: { type: 'LP' } }
            );
          }
          
          // Update name and symbol if they are generic (SLP-V2, UNI-V2, etc.)
          if (existingToken.symbol === 'SLP-V2' || existingToken.symbol === 'UNI-V2' || 
              existingToken.name === 'Simple LP Token V2' || existingToken.name === 'Uniswap V2') {
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
        };

        await db.collection('tokens').updateOne(
          { address: normalizedAddress },
          { $set: tokenDoc },
          { upsert: true }
        );

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

async function main() {
  try {
    // Initialize database connection first
    await initDB();

    // Check command line arguments
    const args = process.argv.slice(2);

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
  --update-single <address>  Update a single token by address
  
Without options, the scanner runs continuously and:
  - Scans for new tokens every 15 minutes
  - Updates VRC-20 token data every 5 minutes
  - Updates VRC-721 token metadata every 15 minutes
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
      await updateTokenWithRealData(tokenAddress);
      await disconnect();
      return;
    }

    if (args.includes('--rescan')) {
      console.log('🔄 Resetting scan progress to rescan from block 0...');
      await ScanProgress.deleteMany({});
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

    // Ensure initial DB connection
    await connectDB();

    // Initial LP token sync from factory (register any new LP tokens)
    console.log('🔄 Initial LP token sync from factory...');
    await syncLPTokensFromFactory();

    // Default: 通常のトークンスキャン＋VRC-721/VRC-20トークンの定期自動更新
    await scanForTokens(); // Run once on start

    // Initial update of VRC-20 tokens (includes LP tokens)
    console.log('🔄 Initial VRC-20/LP token update...');
    await updateAllErc20Tokens();

    setInterval(async () => {
      try {
        await scanForTokens();
      } catch (error) {
        console.error('❌ Error in scanForTokens interval:', error);
      }
    }, SCAN_INTERVAL_MS);

    // VRC-721トークンの自動更新（scanForTokensと同じ間隔で）
    setInterval(async () => {
      try {
        await updateAllVrc721Tokens();
      } catch (error) {
        console.error('❌ Error in updateAllVrc721Tokens interval:', error);
      }
    }, SCAN_INTERVAL_MS);

    // VRC-20トークンの自動更新（5分ごと）
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

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('🛑 Caught interrupt signal. Shutting down gracefully.');
      await disconnect();
      console.log('🔌 Database disconnected.');
      process.exit(0);
    });
  } catch (error) {
    console.error('💥 Error in main function:', error);
    process.exit(1);
  }
}

export { main };

if (require.main === module) {
  main();
}
