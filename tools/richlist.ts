#!/usr/bin/env node
/*
Tool for calculating VirBiCoin richlist - Optimized and simplified
*/

import mongoose from 'mongoose';
import Web3 from 'web3';
import { connectDB, Block, Transaction, Account, IAccount } from '../models/index';
import { loadConfig, getWeb3ProviderURL, AppConfig } from '../lib/config';

// Simplified interface
interface AccountData {
  address: string;
  type: number;
  balance: string; // Wei as string
  blockNumber: number;
}

// Configuration
const config: AppConfig = loadConfig();
const web3 = new Web3(new Web3.providers.HttpProvider(getWeb3ProviderURL()));

// Constants
const BATCH_SIZE = 50; // Optimized batch size
const CHUNK_SIZE = 10; // Chunk size for parallel processing
const MEMORY_LIMIT_MB = parseInt(process.env.MEMORY_LIMIT_MB || '512');
const CACHE_MAX_SIZE = 3000; // Reduced cache size

// Global state
const accountCache = new Map<string, number>();
let processedCount = 0;

// Memory monitoring
const checkMemory = (): boolean => {
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

// Database connection
const initDB = async (): Promise<void> => {
  try {
    if (mongoose.connection.readyState === 1) {
      return; // Already connected
    }
    await connectDB();
    
    // Wait for connection to be fully established
    let retries = 0;
    const maxRetries = 30;
    while ((mongoose.connection.readyState as number) !== 1 && retries < maxRetries) {
      console.log('⌛ Waiting for database connection...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      retries++;
    }
    
    if ((mongoose.connection.readyState as number) !== 1) {
      throw new Error('Database connection timeout');
    }
    
    console.log('🔗 Database connection initialized');
  } catch (error) {
    console.error('❌ Failed to connect to database:', error);
    process.exit(1);
  }
};

// Get unique addresses from transactions with retry
const getTransactionAddresses = async (fromBlock: number, toBlock: number, retries = 3): Promise<Set<string>> => {
  const addresses = new Set<string>();
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Get FROM addresses with timeout
      const fromDocs = await Transaction.aggregate([
          { $match: { blockNumber: { $lte: toBlock, $gt: fromBlock } } },
        { $group: { _id: '$from' } }
      ]).option({ maxTimeMS: 120000 }); // 2 minute timeout
      
      // Get TO addresses with timeout
      const toDocs = await Transaction.aggregate([
        { $match: { blockNumber: { $lte: toBlock, $gt: fromBlock } } },
        { $group: { _id: '$to' } }
      ]).option({ maxTimeMS: 120000 });
      
      // Get miner addresses with timeout
      const minerDocs = await Block.aggregate([
        { $match: { number: { $lte: toBlock, $gt: fromBlock } } },
        { $group: { _id: '$miner' } }
      ]).option({ maxTimeMS: 120000 });
      
      // Combine all addresses
      [...fromDocs, ...toDocs, ...minerDocs].forEach(doc => {
        if (doc._id && doc._id !== '0x0000000000000000000000000000000000000000') {
          addresses.add(doc._id);
        }
      });
      
      console.log(`📊 Found ${addresses.size} unique addresses in blocks ${fromBlock}-${toBlock}`);
      return addresses;
      
    } catch (error) {
      console.error(`❌ Error getting transaction addresses (attempt ${attempt}/${retries}):`, error);
      if (attempt < retries) {
        const waitTime = attempt * 10000; // 10s, 20s, 30s
        console.log(`⏳ Waiting ${waitTime/1000}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  console.error('❌ All retries failed for getTransactionAddresses');
  return new Set();
};

// Get account data with balance and type
const getAccountData = async (address: string, blockNumber: number): Promise<AccountData | null> => {
  try {
    const [balance, code] = await Promise.all([
      web3.eth.getBalance(address),
      web3.eth.getCode(address)
    ]);
    
    return {
      address,
      type: code.length > 2 ? 1 : 0, // 1 for contract, 0 for EOA
      balance: balance.toString(),
      blockNumber
    };
    } catch (error) {
    console.warn(`⚠️ Failed to get data for ${address}:`, error);
    return null;
  }
};

// Process accounts in chunks
const processAccountChunk = async (addresses: string[], blockNumber: number): Promise<AccountData[]> => {
  const promises = addresses.map(address => getAccountData(address, blockNumber));
  const results = await Promise.all(promises);
  
  return results.filter((data): data is AccountData => data !== null);
};

// Bulk insert accounts to database
const bulkInsertAccounts = async (accounts: AccountData[]): Promise<void> => {
  if (accounts.length === 0) return;
  
  try {
    const operations = accounts.map(account => ({
      updateOne: {
        filter: { address: account.address },
        update: {
          $set: {
            address: account.address,
            type: account.type,
            balance: account.balance,
            blockNumber: account.blockNumber
          }
        },
        upsert: true
      }
    }));
    
    await Account.bulkWrite(operations, { ordered: false });
    console.log(`💾 Updated ${accounts.length} accounts in database`);
    
  } catch (error) {
    console.error('❌ Error bulk inserting accounts:', error);
  }
};

// Update account percentages
const updatePercentages = async (): Promise<void> => {
  try {
    console.log('📊 Calculating account percentages...');
    
    const accounts = await Account.find({}).select('address balance').lean();
    
    // Calculate total supply
    const totalSupply = accounts.reduce((sum, account) => {
      try {
        const balance = parseFloat(Web3.utils.fromWei(account.balance || '0', 'ether'));
        return sum + balance;
      } catch {
        return sum;
      }
    }, 0);
    
    console.log(`💰 Total supply: ${totalSupply.toFixed(2)} ETH`);
    
    // Update percentages in batches
    const batchSize = 1000;
    for (let i = 0; i < accounts.length; i += batchSize) {
      const batch = accounts.slice(i, i + batchSize);
      
      const operations = batch.map(account => {
        try {
          const balance = parseFloat(Web3.utils.fromWei(account.balance || '0', 'ether'));
          const percentage = totalSupply > 0 ? (balance / totalSupply) * 100 : 0;
          
          return {
            updateOne: {
              filter: { address: account.address },
              update: { $set: { percentage } }
            }
          };
        } catch {
          return {
            updateOne: {
              filter: { address: account.address },
              update: { $set: { percentage: 0 } }
            }
          };
        }
      });
      
      await Account.bulkWrite(operations, { ordered: false });
      console.log(`📈 Updated percentages for batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(accounts.length/batchSize)}`);
    }
    
  } catch (error) {
    console.error('❌ Error updating percentages:', error);
  }
};

// Main richlist calculation
const makeRichList = async (toBlock: number, blocks: number): Promise<void> => {
  // Ensure database connection before starting
  await initDB();
  
  const fromBlock = Math.max(0, toBlock - blocks);
  const isEnd = fromBlock === toBlock;
  
  if (!config.general?.quiet && (toBlock - fromBlock) >= 100) {
    console.log(`🔍 Processing blocks ${fromBlock} to ${toBlock}...`);
  }
  
  try {
    // Get all unique addresses
    const addresses = await getTransactionAddresses(fromBlock, toBlock);
    
    if (addresses.size === 0) {
      if (isEnd) {
        console.log('✅ No new addresses found. Richlist calculation complete.');
        return;
      } else {
        setTimeout(() => makeRichList(fromBlock, blocks), 500);
        return;
      }
    }
    
    // Filter addresses using cache - but also periodically update existing ones
    const newAddresses: string[] = [];
    const existingAddressesToUpdate: string[] = [];
    
    for (const address of addresses) {
      const count = accountCache.get(address) || 0;
      if (count < 3) { 
        // New or rarely seen addresses - always process
        newAddresses.push(address);
        accountCache.set(address, count + 1);
      } else if (count < 10) {
        // Recently active addresses - 30% chance to update balance
        if (Math.random() < 0.3) {
          existingAddressesToUpdate.push(address);
        }
        accountCache.set(address, count + 1);
      } else if (count < 25 && Math.random() < 0.1) {
        // Older addresses - 10% chance to update balance
        existingAddressesToUpdate.push(address);
        accountCache.set(address, count + 1);
      } else {
        // Just increment counter for frequently seen addresses
        accountCache.set(address, Math.min(count + 1, 100)); // Cap at 100
      }
    }
    
    // Combine addresses to process
    const addressesToProcess = [...newAddresses, ...existingAddressesToUpdate];
    
    // Clean cache if too large
    if (accountCache.size > CACHE_MAX_SIZE) {
      const sortedEntries = Array.from(accountCache.entries()).sort((a, b) => b[1] - a[1]);
      accountCache.clear();
      sortedEntries.slice(0, Math.floor(CACHE_MAX_SIZE * 0.6)).forEach(([addr, count]) => {
        accountCache.set(addr, count);
      });
      console.log(`🧹 Cache cleaned, size: ${accountCache.size}`);
    }
    
    if (addressesToProcess.length === 0) {
      console.log(`📋 All ${addresses.size} addresses cached, skipping to next batch`);
    } else {
      const newCount = newAddresses.length;
      const updateCount = existingAddressesToUpdate.length;
      const totalFound = addresses.size;
      const cached = totalFound - addressesToProcess.length;
      
      if (updateCount > 0) {
        console.log(`📋 Processing ${newCount} new + ${updateCount} existing addresses (${cached} cached)`);
      } else {
        console.log(`📋 Processing ${newCount} new addresses (${cached} cached)`);
      }
    }
    
    // Process addresses in chunks (both new and existing to update)
    const allAccountData: AccountData[] = [];
    if (addressesToProcess.length > 0) {
      for (let i = 0; i < addressesToProcess.length; i += CHUNK_SIZE) {
        const chunk = addressesToProcess.slice(i, i + CHUNK_SIZE);
        const chunkData = await processAccountChunk(chunk, toBlock);
        allAccountData.push(...chunkData);
        
        // Memory check
        if (!checkMemory()) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // Save to database
      if (allAccountData.length > 0) {
        await bulkInsertAccounts(allAccountData);
        processedCount += allAccountData.length;
        console.log(`📊 Total processed: ${processedCount} accounts (${newAddresses.length} new, ${existingAddressesToUpdate.length} updated)`);
      }
    }
    
    if (isEnd) {
      console.log('✅ Richlist calculation completed. Updating percentages...');
      await updatePercentages();
      console.log('🎉 All done!');
    } else {
      // Continue with next batch (reduced delay when no processing needed)
      const delay = addressesToProcess.length === 0 ? 100 : 500; // Faster when all cached
      setTimeout(() => makeRichList(fromBlock, blocks), delay);
    }
    
  } catch (error) {
    console.error('❌ Error in makeRichList:', error);
  }
};

// Start sync process
const startSync = async (): Promise<void> => {
  await initDB();
  
  try {
    console.log('🚀 Starting richlist sync...');
    const latestBlock = await web3.eth.getBlockNumber();
    const blockNumber = Number(latestBlock);
    
    console.log(`📦 Latest block: ${blockNumber}`);
    await makeRichList(blockNumber, BATCH_SIZE);

  } catch (error) {
    console.error('❌ Error in startSync:', error);
    process.exit(1);
  }
};

// Main execution
if (require.main === module) {
  console.log('💎 VirBiCoin Richlist Calculator - Optimized');
  startSync().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { makeRichList, updatePercentages };