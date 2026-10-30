/**
 * Script to register known contracts from config.json into the database
 * Run with: npx tsx --tsconfig tsconfig.tools.json tools/register-contracts.ts
 */

import '../lib/env'; // .env / .env.local before any other module reads process.env
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { connectDB, ensureIndexesOnStartup, Contract } from '../models/index';
import { countAll } from '../lib/db/count';

// Read config
const readConfig = () => {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    const exampleConfigPath = path.join(process.cwd(), 'config.example.json');

    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } else if (fs.existsSync(exampleConfigPath)) {
      return JSON.parse(fs.readFileSync(exampleConfigPath, 'utf8'));
    }
  } catch (error) {
    console.error('Error reading config:', error);
  }
  return null;
};

async function registerContracts() {
  const config = readConfig();
  if (!config) {
    console.error('❌ Failed to read config.json');
    process.exit(1);
  }

  // Connect to MongoDB through the shared connector (env > config.json > default)
  await connectDB();
  if (mongoose.connection.readyState !== 1) {
    console.error('❌ Failed to connect to MongoDB');
    process.exit(1);
  }
  console.log('✅ Connected to MongoDB');
  await ensureIndexesOnStartup('register-contracts');

  // Gather all contracts from config
  const contracts: Array<{
    address: string;
    contractName: string;
    symbol?: string;
    tokenName?: string;
    decimals?: number;
    type: 'contract' | 'token';
  }> = [];

  // DEX Contracts
  if (config.dex) {
    if (config.dex.factory) {
      contracts.push({
        address: config.dex.factory.toLowerCase(),
        contractName: 'SimpleFactoryV2',
        type: 'contract',
      });
    }
    if (config.dex.router) {
      contracts.push({
        address: config.dex.router.toLowerCase(),
        contractName: 'SimpleRouterV2',
        type: 'contract',
      });
    }
    if (config.dex.masterChef) {
      contracts.push({
        address: config.dex.masterChef.toLowerCase(),
        contractName: 'MasterChef',
        type: 'contract',
      });
    }

    // Wrapped Native Token
    if (config.dex.wrappedNative) {
      contracts.push({
        address: config.dex.wrappedNative.address.toLowerCase(),
        contractName: config.dex.wrappedNative.name || 'WVBC',
        symbol: config.dex.wrappedNative.symbol,
        tokenName: config.dex.wrappedNative.name,
        decimals: config.dex.wrappedNative.decimals || 18,
        type: 'token',
      });
    }

    // Reward Token
    if (config.dex.rewardToken) {
      contracts.push({
        address: config.dex.rewardToken.address.toLowerCase(),
        contractName: config.dex.rewardToken.name || 'VBCG',
        symbol: config.dex.rewardToken.symbol,
        tokenName: config.dex.rewardToken.name,
        decimals: config.dex.rewardToken.decimals || 18,
        type: 'token',
      });
    }

    // Other DEX Tokens
    if (config.dex.tokens) {
      for (const [key, token] of Object.entries(config.dex.tokens)) {
        const t = token as any;
        if (t.address) {
          contracts.push({
            address: t.address.toLowerCase(),
            contractName: t.name || key,
            symbol: t.symbol,
            tokenName: t.name,
            decimals: t.decimals || 18,
            type: 'token',
          });
        }
      }
    }

    // LP Tokens
    if (config.dex.lpTokens) {
      for (const [key, lp] of Object.entries(config.dex.lpTokens)) {
        const l = lp as any;
        if (l.address) {
          contracts.push({
            address: l.address.toLowerCase(),
            contractName: l.name || key,
            symbol: l.symbol,
            tokenName: l.name,
            type: 'token',
          });
        }
      }
    }
  }

  // Launchpad
  if (config.launchpad?.factoryAddress) {
    contracts.push({
      address: config.launchpad.factoryAddress.toLowerCase(),
      contractName: 'TokenFactory',
      type: 'contract',
    });
  }

  console.log(`\n📋 Found ${contracts.length} contracts in config.json:\n`);

  // Register each contract
  for (const contract of contracts) {
    try {
      // Check if contract already exists
      const existing = await Contract.findOne({ address: contract.address });

      if (existing) {
        // Update only if not verified (don't overwrite verified contracts)
        if (!existing.verified) {
          await Contract.updateOne(
            { address: contract.address },
            {
              $set: {
                contractName: contract.contractName,
                symbol: contract.symbol,
                tokenName: contract.tokenName,
                decimals: contract.decimals,
                ERC: contract.type === 'token' ? 2 : 0,
              },
            }
          );
          console.log(`📝 Updated: ${contract.contractName} (${contract.address})`);
        } else {
          console.log(
            `⏭️  Skipped (already verified): ${contract.contractName} (${contract.address})`
          );
        }
      } else {
        // Create new entry
        await Contract.create({
          address: contract.address,
          contractName: contract.contractName,
          symbol: contract.symbol,
          tokenName: contract.tokenName,
          decimals: contract.decimals,
          ERC: contract.type === 'token' ? 2 : 0, // 2 = ERC20
          verified: false,
        });
        console.log(`✅ Created: ${contract.contractName} (${contract.address})`);
      }
    } catch (error: any) {
      if (error.code === 11000) {
        console.log(`⚠️  Duplicate key, skipping: ${contract.contractName} (${contract.address})`);
      } else {
        console.error(`❌ Error for ${contract.contractName}:`, error.message);
      }
    }
  }

  console.log('\n✅ Contract registration complete!');

  // Show summary
  const totalContracts = await countAll(Contract);
  const verifiedContracts = await Contract.countDocuments({ verified: true });
  console.log(`\n📊 Database Summary:`);
  console.log(`   Total contracts: ${totalContracts}`);
  console.log(`   Verified contracts: ${verifiedContracts}`);

  await mongoose.disconnect();
}

registerContracts().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
