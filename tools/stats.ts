#!/usr/bin/env node
/*
Tool for calculating VirBiCoin block statistics
*/

import mongoose from 'mongoose';
import Web3 from 'web3';
import type { Block as Web3Block } from 'web3-types';
import { connectDB, Block, BlockStat, IBlock, IBlockStat } from '../models/index';
import { loadConfig, getWeb3ProviderURL } from '../lib/config';

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
  const limitMB = parseInt(process.env.MEMORY_LIMIT_MB || '512'); // Optimized for 2GB instances

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

// Interface definitions
interface Config {
  nodeAddr: string;
  port: number;
  bulkSize: number;
  quiet: boolean;
}

interface BlockStatData {
  number: number;
  timestamp: number;
  difficulty: string;
  txCount: number;
  gasUsed: number;
  gasLimit: number;
  miner: string;
  blockTime: number;
  uncleCount: number;
}

// Configuration
const config = loadConfig();

// Initialize database connection after config is loaded
initDB();

console.log(`🔌 Connecting to VirBiCoin node ${getWeb3ProviderURL()}...`);

// Web3 connection
const web3 = new Web3(new Web3.providers.HttpProvider(getWeb3ProviderURL()));

if (config.quiet) {
  console.log('🔇 Quiet mode enabled');
}

/**
 * Update statistics for a range of blocks with improved performance and parallel processing
 */
const updateStats = async (range: number, interval: number, rescan: boolean): Promise<void> => {
  // Ensure database is connected before proceeding
  if (mongoose.connection.readyState !== 1) {
    console.log('⌛ Waiting for database connection...');
    await connectDB();
  }

  let latestBlockBigInt = await web3.eth.getBlockNumber();
  let latestBlock = toNumber(latestBlockBigInt);

  interval = Math.abs(parseInt(interval.toString()));
  if (!range) {
    range = 1000; // Reduced from 5000 to 1000 for better performance
  }
  range *= interval;
  if (interval >= 10) {
    latestBlock -= latestBlock % interval;
  }

  const startBlock = latestBlock - range;
  const endBlock = latestBlock;

  // Check which blocks already have statistics
  const existingStats = await BlockStat.find({
    number: { $gte: startBlock, $lte: endBlock },
  })
    .select('number')
    .lean();

  const existingStatNumbers = new Set(existingStats.map((s) => s.number));
  console.log(
    `📊 Found ${existingStats.length} existing block statistics in range ${startBlock}-${endBlock}`
  );

  // Process in parallel batches for better performance
  await processStatsInBatches(startBlock, endBlock, interval, rescan, existingStatNumbers);
};

/**
 * Process statistics in parallel batches for improved performance
 */
const processStatsInBatches = async (
  startBlock: number,
  endBlock: number,
  interval: number,
  rescan: boolean,
  existingStatNumbers: Set<number>
): Promise<void> => {
  const BATCH_SIZE = 20; // Reduced for 2GB instances
  const CONCURRENCY_LIMIT = 3; // Reduced concurrent fetches for low memory

  console.log(`🚀 Processing stats from block ${startBlock} to ${endBlock} in batches...`);

  for (let batchStart = endBlock; batchStart > startBlock; batchStart -= BATCH_SIZE) {
    const batchEnd = Math.max(batchStart - BATCH_SIZE + 1, startBlock);
    const batchBlocks = [];

    // Collect blocks that need processing
    for (let blockNum = batchStart; blockNum >= batchEnd; blockNum -= interval) {
      if (rescan || !existingStatNumbers.has(blockNum)) {
        batchBlocks.push(blockNum);
      }
    }

    if (batchBlocks.length === 0) {
      continue; // Skip this batch if all stats exist
    }

    console.log(
      `📈 Processing stats batch ${batchEnd}-${batchStart} (${batchBlocks.length} blocks)`
    );

    try {
      // Process blocks in smaller chunks for parallel processing
      const chunks = [];
      for (let i = 0; i < batchBlocks.length; i += CONCURRENCY_LIMIT) {
        chunks.push(batchBlocks.slice(i, i + CONCURRENCY_LIMIT));
      }

      const allStatsData = [];

      for (const chunk of chunks) {
        // Fetch blocks in parallel within each chunk
        const blockPromises = chunk.map(async (blockNum) => {
          try {
            const [blockData, nextBlockData] = await Promise.all([
              web3.eth.getBlock(blockNum, true),
              blockNum < endBlock
                ? web3.eth.getBlock(blockNum + interval, true)
                : Promise.resolve(null),
            ]);
            return { blockNum, blockData, nextBlockData };
          } catch (error) {
            console.log(`❌ Error fetching block ${blockNum}: ${error}`);
            return { blockNum, blockData: null, nextBlockData: null };
          }
        });

        const chunkResults = await Promise.all(blockPromises);
        allStatsData.push(...chunkResults);

        // Small delay between chunks to prevent overwhelming the node
        if (chunks.length > 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      // Batch create statistics
      const statsToInsert = [];

      for (const { blockNum, blockData, nextBlockData } of allStatsData) {
        if (blockData) {
          try {
            // Check if stat already exists
            const existingStat = await BlockStat.findOne({ number: blockNum }).lean();

            if (existingStat && !rescan) {
              continue;
            }

            if (nextBlockData) {
              // Calculate statistics
              const stat: BlockStatData = {
                number: toNumber(blockData.number),
                timestamp: toNumber(blockData.timestamp),
                difficulty: toString(blockData.difficulty),
                txCount: blockData.transactions.length,
                gasUsed: toNumber(blockData.gasUsed),
                gasLimit: toNumber(blockData.gasLimit),
                miner: toString(blockData.miner),
                blockTime:
                  (toNumber(nextBlockData.timestamp) - toNumber(blockData.timestamp)) /
                  (toNumber(nextBlockData.number) - toNumber(blockData.number)),
                uncleCount: blockData.uncles.length,
              };

              statsToInsert.push(stat);
            }
          } catch (error) {
            console.log(`❌ Error processing stats for block ${blockNum}: ${error}`);
          }
        }
      }

      // Bulk insert statistics
      if (statsToInsert.length > 0) {
        try {
          await BlockStat.insertMany(statsToInsert, { ordered: false });
          console.log(`✅ Inserted ${statsToInsert.length} block statistics`);
        } catch (error) {
          // Handle duplicate key errors gracefully
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (!errorMessage.includes('duplicate key') && !errorMessage.includes('E11000')) {
            console.log(`❌ Database error: ${errorMessage}`);
          }
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
      const progress = (((endBlock - batchEnd + 1) / (endBlock - startBlock + 1)) * 100).toFixed(1);
      console.log(`📊 Stats batch completed: ${batchEnd}-${batchStart} | Progress: ${progress}%`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`❌ Error processing stats batch ${batchEnd}-${batchStart}: ${errorMessage}`);
    }
  }

  console.log(`✅ Statistics processing completed for range ${startBlock}-${endBlock}`);
};

/**
 * Get statistics for blocks with improved performance
 */
const getStats = async function (
  blockNumber: number,
  nextBlock: any | null,
  endNumber: number,
  interval: number,
  rescan: boolean,
  existingStatNumbers?: Set<number>
): Promise<void> {
  if (endNumber < 0) endNumber = 0;

  if (blockNumber <= endNumber) {
    if (rescan) {
      process.exit(9);
    }
    return;
  }

  // メモリ監視を追加
  if (!checkMemory()) {
    console.log('💾 Memory limit reached, pausing stats processing for 5 seconds');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  try {
    // Test connection by getting latest block number instead of using isListening
    try {
      await web3.eth.getBlockNumber();
    } catch (connectionError) {
      console.log(
        `❌ Error: Aborted due to web3 not connected when trying to get block ${blockNumber}`
      );
      process.exit(9);
      return;
    }

    const blockData = await web3.eth.getBlock(blockNumber, true);

    if (!blockData) {
      console.log(`⚠️  Warning: null block data received from block number: ${blockNumber}`);
      return;
    }

    if (nextBlock) {
      checkBlockDBExistsThenWrite(
        blockData,
        nextBlock,
        endNumber,
        interval,
        rescan,
        existingStatNumbers
      );
    } else {
      checkBlockDBExistsThenWrite(
        blockData,
        null,
        endNumber,
        interval,
        rescan,
        existingStatNumbers
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`⚠️  Warning: error on getting block with number: ${blockNumber}: ${errorMessage}`);
  }
};

/**
 * Check if block statistics exist and write if not with improved performance
 */
const checkBlockDBExistsThenWrite = async function (
  blockData: any,
  nextBlock: any | null,
  endNumber: number,
  interval: number,
  rescan: boolean,
  existingStatNumbers?: Set<number>
): Promise<void> {
  try {
    const blockNumber = toNumber(blockData.number);

    // Check if block statistics already exist in DB
    const existingStat = await BlockStat.findOne({ number: blockNumber });

    if (existingStat && !rescan) {
      getStats(blockNumber - interval, blockData, endNumber, interval, rescan, existingStatNumbers);
      return;
    }

    if (nextBlock) {
      // Calculate hashrate, txCount, blocktime, uncleCount
      const stat: BlockStatData = {
        number: blockNumber,
        timestamp: toNumber(blockData.timestamp),
        difficulty: toString(blockData.difficulty),
        txCount: blockData.transactions.length,
        gasUsed: toNumber(blockData.gasUsed),
        gasLimit: toNumber(blockData.gasLimit),
        miner: toString(blockData.miner),
        blockTime:
          (toNumber(nextBlock.timestamp) - toNumber(blockData.timestamp)) /
          (toNumber(nextBlock.number) - blockNumber),
        uncleCount: blockData.uncles.length,
      };

      const blockStat = new BlockStat(stat);
      await blockStat.save();

      // 1000ブロックごとにログ出力（500から1000に変更）
      if (blockNumber % 1000 === 0) {
        console.log(`📦 Processed ${blockNumber} blocks for statistics`);
      }

      getStats(blockNumber - interval, blockData, endNumber, interval, rescan, existingStatNumbers);
    } else {
      // Continue processing for blocks without next block data
      getStats(blockNumber - interval, blockData, endNumber, interval, rescan, existingStatNumbers);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(
      `💥 Error: Aborted due to error on block number ${toNumber(blockData.number)}: ${errorMessage}`
    );
    process.exit(9);
  }
};

// Configuration for statistics calculation
const minutes = 5; // 2→5分に延長
const statInterval = minutes * 60 * 1000;

let rescan = false; /* rescan: true - rescan range */
let range = 250; // 500→250に削減
let interval = 100;

/**
 * RESCAN=1000:100000 means interval:range
 * Usage:
 *   RESCAN=1000:100000 node tools/stats.ts
 */
if (process.env.RESCAN) {
  const tmp = process.env.RESCAN.split(/:/);
  if (tmp.length > 1) {
    interval = Math.abs(parseInt(tmp[0]));
    if (tmp[1]) {
      range = Math.abs(parseInt(tmp[1]));
    }
  }
  let i = interval;
  let j = 0;
  for (j = 0; i >= 10; j++) {
    i = parseInt((i / 10).toString());
  }
  interval = Math.pow(10, j);
  console.log(`📊 Selected interval = ${interval}`);

  rescan = true;
}

/**
 * Main execution with improved performance
 */
const main = async (): Promise<void> => {
  try {
    // Initialize database connection first
    await initDB();

    // Test connection by getting latest block number
    try {
      await web3.eth.getBlockNumber();
    } catch (connectionError) {
      console.log('Error: Cannot connect to VirBiCoin node');
      process.exit(1);
    }

    console.log('🔗 Connected to VirBiCoin node successfully');
    console.log('📊 Starting statistics calculation...');

    // Run statistics update
    await updateStats(range, interval, rescan);

    // Set up interval for continuous updates if not rescanning
    if (!rescan) {
      setInterval(async () => {
        try {
          await updateStats(range, interval, false);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.log(`❌ Error in interval update: ${errorMessage}`);
        }
      }, statInterval);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`💥 Fatal error: ${errorMessage}`);
    process.exit(1);
  }
};

export { main };

if (require.main === module) {
  main();
}
