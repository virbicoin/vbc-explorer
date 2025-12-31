/**
 * Database Index Optimization Script
 *
 * Creates and optimizes indexes for better query performance.
 * Run this script after initial setup or when adding new indexes.
 *
 * Usage: npx ts-node --project tsconfig.tools.json tools/optimize-indexes.ts
 */

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

// Load config
const configPath = path.join(process.cwd(), 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const MONGODB_URI =
  config.database?.uri || process.env.MONGODB_URI || 'mongodb://localhost:27017/explorerDB';

interface IndexDefinition {
  collection: string;
  indexes: Array<{
    keys: Record<string, 1 | -1 | 'text'>;
    options?: {
      unique?: boolean;
      sparse?: boolean;
      expireAfterSeconds?: number;
    };
  }>;
}

// Index definitions for all collections
const INDEX_DEFINITIONS: IndexDefinition[] = [
  {
    collection: 'blocks',
    indexes: [
      { keys: { number: -1 } },
      { keys: { hash: 1 }, options: { unique: true } },
      { keys: { miner: 1 } },
      { keys: { timestamp: -1 } },
      { keys: { miner: 1, number: -1 } }, // For mined blocks query
    ],
  },
  {
    collection: 'Transaction',
    indexes: [
      { keys: { hash: 1 }, options: { unique: true } },
      { keys: { blockNumber: -1 } },
      { keys: { from: 1, blockNumber: -1 } },
      { keys: { to: 1, blockNumber: -1 } },
      { keys: { timestamp: -1 } },
      { keys: { from: 1, timestamp: -1 } }, // For address transactions
      { keys: { to: 1, timestamp: -1 } }, // For address transactions
    ],
  },
  {
    collection: 'Account',
    indexes: [
      { keys: { address: 1 }, options: { unique: true } },
      { keys: { balance: -1 } }, // For richlist
      { keys: { type: 1, balance: -1 } }, // For contract list
    ],
  },
  {
    collection: 'Contract',
    indexes: [
      { keys: { address: 1 }, options: { unique: true } },
      { keys: { ERC: 1 } },
      { keys: { verified: 1 } },
      { keys: { tokenName: 1 } },
      { keys: { symbol: 1 } },
      { keys: { blockNumber: -1 } },
    ],
  },
  {
    collection: 'tokentransfers',
    indexes: [
      { keys: { tokenAddress: 1, timestamp: -1 } },
      { keys: { tokenAddress: 1, blockNumber: -1 } },
      { keys: { from: 1, timestamp: -1 } },
      { keys: { to: 1, timestamp: -1 } },
      { keys: { transactionHash: 1 } },
      { keys: { tokenAddress: 1, tokenId: 1, blockNumber: 1, to: 1 } }, // For NFT sync
      // Compound index for NFT ownership calculation
      { keys: { tokenAddress: 1, tokenId: 1, timestamp: 1 } },
    ],
  },
  {
    collection: 'tokenholders',
    indexes: [
      { keys: { tokenAddress: 1, balance: -1 } },
      { keys: { holderAddress: 1 } },
      { keys: { tokenAddress: 1, holderAddress: 1 }, options: { unique: true } },
    ],
  },
  {
    collection: 'BlockStat',
    indexes: [{ keys: { timestamp: -1 } }, { keys: { number: -1 }, options: { unique: true } }],
  },
];

async function createIndexes(): Promise<void> {
  console.log('🔗 Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected\n');

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection not established');
  }

  for (const def of INDEX_DEFINITIONS) {
    console.log(`📦 Collection: ${def.collection}`);

    try {
      const collection = db.collection(def.collection);

      for (const index of def.indexes) {
        const indexName = Object.entries(index.keys)
          .map(([k, v]) => `${k}_${v}`)
          .join('_');

        try {
          await collection.createIndex(index.keys, {
            ...index.options,
            background: true, // Non-blocking
          });
          console.log(`  ✅ Created: ${indexName}`);
        } catch (err) {
          const error = err as Error;
          if (error.message.includes('already exists')) {
            console.log(`  ⏭️  Exists: ${indexName}`);
          } else {
            console.log(`  ❌ Failed: ${indexName} - ${error.message}`);
          }
        }
      }
    } catch (err) {
      console.log(`  ⚠️  Collection may not exist yet: ${def.collection}`);
    }

    console.log('');
  }

  // Show index statistics
  console.log('📊 Index Statistics:');
  for (const def of INDEX_DEFINITIONS) {
    try {
      const collection = db.collection(def.collection);
      const indexes = await collection.indexes();
      console.log(`  ${def.collection}: ${indexes.length} indexes`);
    } catch {
      // Collection doesn't exist
    }
  }

  await mongoose.disconnect();
  console.log('\n✅ Done!');
}

// Run
createIndexes().catch(console.error);
