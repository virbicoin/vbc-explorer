import mongoose from 'mongoose';
import { connectDB as connectDBFromModels } from '../models/index';

// Use the connectDB function from models/index.ts
async function connectDB() {
  await connectDBFromModels();
}

// Cache configuration
interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  expiry: number;
}

const statsCache = new Map<string, CacheEntry>();
const CACHE_DURATION = 300000; // 5 minutes cache for t4g.small instances

// Helper function to get cached data or execute callback
async function getCachedData<T>(key: string, callback: () => Promise<T>, customTTL?: number): Promise<T> {
  const now = Date.now();
  const cached = statsCache.get(key);
  
  if (cached && now < cached.expiry) {
    return cached.data as T;
  }
  
  const data = await callback();
  statsCache.set(key, {
    data,
    timestamp: now,
    expiry: now + (customTTL || CACHE_DURATION)
  });
  
  return data;
}

export async function getChainStats() {
  try {
    await connectDB();
  } catch (error) {
    console.error('Error connecting to database:', error);
    throw new Error('Database connection failed');
  }

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection not available');
  }
  
  // Get latest block information with caching
  const { latestBlockDoc, latestBlock } = await getCachedData('latestBlock', async () => {
    try {
      const blockDoc = await db.collection('Block').findOne(
        {}, 
        { sort: { number: -1 }, maxTimeMS: 30000 }
      );
      const blockNum = blockDoc ? blockDoc.number : 0;
      console.log('[Stats] Latest block found:', blockNum);
      return { latestBlockDoc: blockDoc, latestBlock: blockNum };
    } catch (error) {
      console.error('[Stats] Error getting latest block:', error);
      return { latestBlockDoc: null, latestBlock: 0 };
    }
  }, 300000); // 5 minute cache for latest block (for t4g.small)
  
  // Calculate average block time from last 100 blocks with caching
  const avgBlockTime = await getCachedData('avgBlockTime', async () => {
    try {
      const recentBlocks = await db.collection('Block').find({})
        .sort({ number: -1 })
        .limit(100)
        .project({ timestamp: 1, number: 1, blockTime: 1 })
        .maxTimeMS(30000)
        .toArray();
      
      if (recentBlocks && recentBlocks.length >= 2) {
        // Method 1: Use stored blockTime if available
        const blocksWithTime = recentBlocks.filter(b => b.blockTime && b.blockTime > 0);
        if (blocksWithTime.length > 0) {
          const avgTime = blocksWithTime.reduce((sum, block) => sum + block.blockTime, 0) / blocksWithTime.length;
          return avgTime.toFixed(2);
        } else {
          // Method 2: Calculate from timestamps
          let totalTimeDiff = 0;
          let validPairs = 0;
          
          for (let i = 0; i < recentBlocks.length - 1; i++) {
            const current = recentBlocks[i];
            const next = recentBlocks[i + 1];
            
            if (current.timestamp && next.timestamp) {
              const timeDiff = current.timestamp - next.timestamp;
              if (timeDiff > 0 && timeDiff < 300) { // Reasonable block time (< 5 minutes)
                totalTimeDiff += timeDiff;
                validPairs++;
              }
            }
          }
          
          if (validPairs > 0) {
            return (totalTimeDiff / validPairs).toFixed(2);
          }
        }
      }
      return '13.00';
    } catch (error) {
      console.error('Error calculating average block time:', error);
      return '13.00';
    }
  }, 300000); // 5 minute cache for block time (for t4g.small)

  // Get network difficulty from latest block
  let networkDifficulty = 'N/A';
  if (latestBlockDoc && latestBlockDoc.difficulty) {
    try {
      const difficultyNum = parseInt(latestBlockDoc.difficulty);
      if (!isNaN(difficultyNum)) {
        // Format difficulty in a readable way
        if (difficultyNum > 1e12) {
          networkDifficulty = (difficultyNum / 1e12).toFixed(2) + ' TH';
        } else if (difficultyNum > 1e9) {
          networkDifficulty = (difficultyNum / 1e9).toFixed(2) + ' GH';
        } else if (difficultyNum > 1e6) {
          networkDifficulty = (difficultyNum / 1e6).toFixed(2) + ' MH';
        } else if (difficultyNum > 1e3) {
          networkDifficulty = (difficultyNum / 1e3).toFixed(2) + ' KH';
        } else {
          networkDifficulty = difficultyNum.toString();
        }
      }
    } catch (error) {
      console.error('Error formatting network difficulty:', error);
    }
  }

  // Calculate network hashrate (approximate)
  let networkHashrate = '0';
  if (latestBlockDoc && latestBlockDoc.difficulty && avgBlockTime) {
    try {
      const difficulty = parseInt(latestBlockDoc.difficulty);
      const blockTimeSeconds = parseFloat(avgBlockTime);
      
      if (!isNaN(difficulty) && !isNaN(blockTimeSeconds) && blockTimeSeconds > 0) {
        // Simplified hashrate calculation: difficulty / block_time
        const hashrate = difficulty / blockTimeSeconds;
        
        if (hashrate > 1e12) {
          networkHashrate = (hashrate / 1e12).toFixed(2) + ' TH/s';
        } else if (hashrate > 1e9) {
          networkHashrate = (hashrate / 1e9).toFixed(2) + ' GH/s';
        } else if (hashrate > 1e6) {
          networkHashrate = (hashrate / 1e6).toFixed(2) + ' MH/s';
        } else if (hashrate > 1e3) {
          networkHashrate = (hashrate / 1e3).toFixed(2) + ' KH/s';
        } else {
          networkHashrate = hashrate.toFixed(2) + ' H/s';
        }
      }
    } catch (error) {
      console.error('Error calculating network hashrate:', error);
    }
  }

  // Calculate average gas price (excluding mining rewards)
  let avgTransactionFee = '0';
  try {
    const recentTxs = await db?.collection('Transaction').find({ 
      gasPrice: { $exists: true, $ne: null },
      from: { $ne: '0x0000000000000000000000000000000000000000' } // Exclude mining rewards
    })
      .sort({ blockNumber: -1 })
      .limit(100)
      .project({ gasPrice: 1 })
      .toArray();
    
    if (recentTxs && recentTxs.length > 0) {
      let totalGasPrice = 0;
      let validTxs = 0;
      
      recentTxs.forEach(tx => {
        if (tx.gasPrice) {
          try {
            const gasPrice = parseInt(tx.gasPrice);
            if (!isNaN(gasPrice) && gasPrice > 0) {
              totalGasPrice += gasPrice;
              validTxs++;
            }
          } catch {
            // Skip invalid transactions
          }
        }
      });
      
      if (validTxs > 0) {
            const avgGasPriceWei = totalGasPrice / validTxs;
    const avgGasPriceGasUnit = avgGasPriceWei / 1e9;
    avgTransactionFee = Math.floor(avgGasPriceGasUnit).toString();
      }
    }
  } catch (error) {
    console.error('Error calculating average gas price:', error);
  }

  // Get actual wallet count by counting unique addresses
  let activeAddresses = 0;
  try {
    // First try to get from accounts collection
    activeAddresses = await db?.collection('Account').countDocuments() || 0;
    
    // If accounts collection is empty, calculate from transactions
    if (activeAddresses === 0) {
      const transactions = await db?.collection('Transaction').find({}, { projection: { from: 1, to: 1 } }).toArray();
      const uniqueAddresses = new Set();
      
      if (transactions) {
         
        transactions.forEach((tx: any) => {
          if (tx.from) uniqueAddresses.add(tx.from.toLowerCase());
          if (tx.to) uniqueAddresses.add(tx.to.toLowerCase());
        });
      }
      
      activeAddresses = uniqueAddresses.size;
    }
  } catch (error) {
    console.error('Error calculating active addresses:', error);
    activeAddresses = 0; // Fallback to 0 if calculation fails
  }

  const totalSupply = "unlimited"; // VBC has unlimited supply
  const totalTransactions = await getCachedData('totalTransactions', async () => {
    try {
      const count = await db.collection('Transaction').estimatedDocumentCount();
      console.log('[Stats] Total transactions found:', count);
      return count;
    } catch (error) {
      console.error('[Stats] Error getting total transactions:', error);
      return 0;
    }
  }, 120000); // 2 minute cache for transaction count
  
  // Calculate time since last block
  let lastBlockTime = 'Unknown';
  if (latestBlockDoc && latestBlockDoc.timestamp) {
    const blockTimestamp = latestBlockDoc.timestamp * 1000; // Convert to milliseconds
    const now = Date.now();
    const diffMs = now - blockTimestamp;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffDays > 0) {
      lastBlockTime = `${diffDays}d ago`;
    } else if (diffHours > 0) {
      lastBlockTime = `${diffHours}h ago`;
    } else {
      lastBlockTime = `${diffMinutes}m ago`;
    }
  }
  
  return {
    latestBlock,
    avgBlockTime,
    networkHashrate,
    networkDifficulty,
    totalTransactions,
    activeAddresses,
    totalSupply,
    avgTransactionFee,
    lastBlockTime,
    lastBlockTimestamp: latestBlockDoc?.timestamp || 0,
    isConnected: true,
  };
}