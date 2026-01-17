#!/usr/bin/env node

/**
 * Rescan Contracts Tool
 *
 * This tool rescans existing contracts in the database to detect their correct type
 * (ERC-20, ERC-721, ERC-1155) and update the database accordingly.
 *
 * Usage:
 *   npx tsx tools/rescan-contracts.ts [options]
 *
 * Options:
 *   --all        Rescan all contracts
 *   --unknown    Rescan only contracts with unknown type (ERC=0 or null)
 *   --address    Rescan a specific contract address
 *   --dry-run    Show what would be updated without making changes
 */

import Web3 from 'web3';
import mongoose from 'mongoose';
import { connectDB, Contract } from '../models/index';
import { loadConfig, getWeb3ProviderURL } from '../lib/config';

// ERC-165 interface IDs
const ERC721_INTERFACE_ID = '0x80ac58cd';
const ERC1155_INTERFACE_ID = '0xd9b67a26';

// ABIs
const ERC165_ABI = [
  {
    constant: true,
    inputs: [{ name: 'interfaceId', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', type: 'bool' }],
    type: 'function',
  },
];

const ERC20_ABI = [
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
  {
    constant: true,
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', type: 'uint256' }],
    type: 'function',
  },
];

interface ContractInfo {
  tokenType: 'ERC20' | 'ERC721' | 'ERC1155' | 'Contract';
  name: string | null;
  symbol: string | null;
  decimals: number;
}

async function detectContractType(web3: Web3, address: string): Promise<ContractInfo> {
  const result: ContractInfo = {
    tokenType: 'Contract',
    name: null,
    symbol: null,
    decimals: 0,
  };

  try {
    // Check if address has bytecode
    const code = await web3.eth.getCode(address);
    if (!code || code === '0x' || code === '0x0') {
      return result;
    }

    // Check for ERC-165 (NFT detection)
    const erc165Contract = new web3.eth.Contract(ERC165_ABI as any, address);

    // Check for ERC-721
    try {
      const isERC721 = await erc165Contract.methods.supportsInterface(ERC721_INTERFACE_ID).call();
      if (isERC721) {
        result.tokenType = 'ERC721';
      }
    } catch {
      // Not ERC-165 compliant or not ERC-721
    }

    // Check for ERC-1155
    if (result.tokenType === 'Contract') {
      try {
        const isERC1155 = await erc165Contract.methods
          .supportsInterface(ERC1155_INTERFACE_ID)
          .call();
        if (isERC1155) {
          result.tokenType = 'ERC1155';
        }
      } catch {
        // Not ERC-1155
      }
    }

    // Try to get token metadata (works for both ERC-20 and NFTs)
    const erc20Contract = new web3.eth.Contract(ERC20_ABI as any, address);

    try {
      const [name, symbol, decimals] = await Promise.all([
        erc20Contract.methods
          .name()
          .call()
          .catch(() => null),
        erc20Contract.methods
          .symbol()
          .call()
          .catch(() => null),
        erc20Contract.methods
          .decimals()
          .call()
          .catch(() => null),
      ]);

      if (name) result.name = String(name);
      if (symbol) result.symbol = String(symbol);
      if (decimals !== null) result.decimals = Number(decimals);

      // If we got name and symbol but type is still Contract, it's likely ERC-20
      if (name && symbol && result.tokenType === 'Contract') {
        result.tokenType = 'ERC20';
      }
    } catch {
      // Failed to get token metadata
    }
  } catch (error: any) {
    console.error(`  ⚠️ Error detecting type for ${address}: ${error.message}`);
  }

  return result;
}

async function rescanContracts(options: {
  all?: boolean;
  unknown?: boolean;
  address?: string;
  dryRun?: boolean;
}) {
  console.log('🔍 Starting contract rescan...');

  // Load config and connect to database
  loadConfig();
  await connectDB();

  // Connect to Web3
  const web3Url = getWeb3ProviderURL();
  console.log(`🔌 Connecting to: ${web3Url}`);
  const web3 = new Web3(web3Url);

  // Test connection
  try {
    await web3.eth.getBlockNumber();
    console.log('✅ Web3 connected');
  } catch (error: any) {
    console.error('❌ Failed to connect to Web3:', error.message);
    process.exit(1);
  }

  // Build query
  let query: any = {};
  if (options.address) {
    query.address = options.address.toLowerCase();
  } else if (options.unknown) {
    query.$or = [
      { ERC: { $in: [0, null] } },
      { ERC: { $exists: false } },
      { type: { $in: [null, 'Contract'] } },
      { type: { $exists: false } },
    ];
  }
  // If options.all, query is empty (all documents)

  // Get contracts
  const contracts = await Contract.find(query).lean();
  console.log(`📋 Found ${contracts.length} contracts to rescan`);

  if (contracts.length === 0) {
    console.log('✅ No contracts to rescan');
    process.exit(0);
  }

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const contract of contracts) {
    const address = contract.address;
    console.log(`\n🔍 Scanning: ${address}`);
    console.log(
      `   Current: ERC=${contract.ERC}, type=${contract.type}, name=${contract.contractName}`
    );

    const info = await detectContractType(web3, address);
    console.log(`   Detected: ${info.tokenType}, name=${info.name}, symbol=${info.symbol}`);

    // Determine if update is needed
    const currentERC = contract.ERC || 0;
    const newERC =
      info.tokenType === 'ERC20'
        ? 2
        : info.tokenType === 'ERC721'
          ? 721
          : info.tokenType === 'ERC1155'
            ? 1155
            : currentERC;

    const newType =
      info.tokenType !== 'Contract' ? `VRC-${info.tokenType.replace('ERC', '')}` : contract.type;

    const needsUpdate =
      (currentERC === 0 && newERC !== 0) ||
      (!contract.type && newType) ||
      (!contract.symbol && info.symbol) ||
      (!contract.tokenName && info.name) ||
      (!contract.decimals && info.decimals);

    if (!needsUpdate) {
      console.log('   ⏭️  No update needed');
      skipped++;
      continue;
    }

    const updateData: any = {};
    if (newERC !== currentERC && newERC !== 0) {
      updateData.ERC = newERC;
    }
    if (newType && newType !== contract.type) {
      updateData.type = newType;
    }
    if (info.symbol && !contract.symbol) {
      updateData.symbol = info.symbol;
    }
    if (info.name && !contract.tokenName) {
      updateData.tokenName = info.name;
    }
    if (info.name && (!contract.contractName || contract.contractName === 'Contract')) {
      updateData.contractName = info.name;
    }
    if (info.decimals && !contract.decimals) {
      updateData.decimals = info.decimals;
    }

    console.log('   📝 Update:', JSON.stringify(updateData));

    if (options.dryRun) {
      console.log('   🔸 Dry run - skipping actual update');
      updated++;
    } else {
      try {
        await Contract.updateOne({ address }, { $set: updateData });
        console.log('   ✅ Updated');
        updated++;
      } catch (error: any) {
        console.error(`   ❌ Update failed: ${error.message}`);
        errors++;
      }
    }

    // Small delay to avoid overwhelming the RPC
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log('\n========================================');
  console.log(`📊 Rescan complete:`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Errors: ${errors}`);
  console.log('========================================');

  await mongoose.disconnect();
  process.exit(0);
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  all: args.includes('--all'),
  unknown:
    args.includes('--unknown') ||
    (!args.includes('--all') && !args.find((a) => a.startsWith('--address'))),
  address: args.find((a) => a.startsWith('--address='))?.split('=')[1],
  dryRun: args.includes('--dry-run'),
};

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Rescan Contracts Tool

Usage:
  npx tsx tools/rescan-contracts.ts [options]

Options:
  --all        Rescan all contracts
  --unknown    Rescan only contracts with unknown type (default)
  --address=X  Rescan a specific contract address
  --dry-run    Show what would be updated without making changes
  --help       Show this help message
`);
  process.exit(0);
}

rescanContracts(options).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
