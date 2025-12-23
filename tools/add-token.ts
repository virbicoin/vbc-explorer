#!/usr/bin/env node
/*
Name: Manual Token Addition Tool
Version: 1.0.0
This tool allows manual addition of ERC20/VRC-20 tokens to the database.
Useful for adding tokens that were deployed before the scanner started.

Usage:
  npx ts-node -P tsconfig.tools.json tools/add-token.ts <token_address>
  npx ts-node -P tsconfig.tools.json tools/add-token.ts 0x52CB9F0d65D9d4De08CF103153C7A1A97567Bb9b

The tool will:
1. Verify the address is a valid ERC20 token
2. Fetch token metadata (name, symbol, decimals, totalSupply)
3. Add/update the token in the database
*/

import Web3 from 'web3';
import mongoose from 'mongoose';
import { connectDB, Contract } from '../models/index';
import { loadConfig, getWeb3ProviderURL } from '../lib/config';

// Define Token schema
const tokenSchema = new mongoose.Schema({
  address: String,
  name: String,
  symbol: String,
  decimals: { type: Number, default: 18 },
  totalSupply: String,
  holders: { type: Number, default: 0 },
  type: String,
  supply: String,
  verified: { type: Boolean, default: false }
}, { collection: 'tokens' });

const Token = mongoose.models.Token || mongoose.model('Token', tokenSchema);

// ERC20 ABI
const ERC20_ABI = [
  {
    "constant": true,
    "inputs": [],
    "name": "name",
    "outputs": [{ "name": "", "type": "string" }],
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "symbol",
    "outputs": [{ "name": "", "type": "string" }],
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "decimals",
    "outputs": [{ "name": "", "type": "uint8" }],
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "totalSupply",
    "outputs": [{ "name": "", "type": "uint256" }],
    "type": "function"
  }
] as const;

const config = loadConfig();
const WEB3_PROVIDER_URL = getWeb3ProviderURL();
const web3 = new Web3(new Web3.providers.HttpProvider(WEB3_PROVIDER_URL));

async function addToken(tokenAddress: string) {
  console.log(`\n🔍 Adding token: ${tokenAddress}\n`);

  // Validate address format
  if (!web3.utils.isAddress(tokenAddress)) {
    console.error('❌ Invalid Ethereum address format');
    process.exit(1);
  }

  // Normalize address to lowercase
  const normalizedAddress = tokenAddress.toLowerCase();

  try {
    // Connect to database
    await connectDB();
    console.log('✅ Connected to database');

    // Check if token already exists
    const existingToken = await Token.findOne({ address: normalizedAddress });
    if (existingToken) {
      console.log(`⚠️ Token already exists in database:`);
      console.log(`   Name: ${existingToken.name}`);
      console.log(`   Symbol: ${existingToken.symbol}`);
      console.log(`   Type: ${existingToken.type}`);
      
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question('   Do you want to update it? (y/N): ', resolve);
      });
      rl.close();
      
      if (answer.toLowerCase() !== 'y') {
        console.log('❌ Aborted');
        process.exit(0);
      }
    }

    // Verify it's a valid ERC20 contract
    const contract = new web3.eth.Contract(ERC20_ABI as any, tokenAddress);
    
    let name: string;
    let symbol: string;
    let decimals: number;
    let totalSupply: bigint;

    try {
      name = await contract.methods.name().call() as string;
      console.log(`   Name: ${name}`);
    } catch (e) {
      console.error('❌ Failed to get token name. This may not be a valid ERC20 token.');
      process.exit(1);
    }

    try {
      symbol = await contract.methods.symbol().call() as string;
      console.log(`   Symbol: ${symbol}`);
    } catch (e) {
      console.error('❌ Failed to get token symbol. This may not be a valid ERC20 token.');
      process.exit(1);
    }

    try {
      decimals = Number(await contract.methods.decimals().call());
      console.log(`   Decimals: ${decimals}`);
    } catch (e) {
      console.log('⚠️ Could not get decimals, defaulting to 18');
      decimals = 18;
    }

    try {
      totalSupply = await contract.methods.totalSupply().call() as bigint;
      console.log(`   Total Supply: ${totalSupply.toString()}`);
    } catch (e) {
      console.log('⚠️ Could not get totalSupply, defaulting to 0');
      totalSupply = 0n;
    }

    // Create or update token in database
    const tokenData = {
      name,
      symbol,
      address: normalizedAddress,
      decimals,
      totalSupply: totalSupply.toString(),
      type: 'VRC-20',
      holders: 0,
      supply: totalSupply.toString(),
    };

    if (existingToken) {
      await Token.updateOne({ address: normalizedAddress }, { $set: tokenData });
      console.log(`\n✅ Token updated successfully!`);
    } else {
      const newToken = new Token(tokenData);
      await newToken.save();
      console.log(`\n✅ Token added successfully!`);
    }

    // Also ensure it exists in Contract collection
    const existingContract = await Contract.findOne({ address: normalizedAddress });
    if (!existingContract) {
      const newContract = new Contract({
        address: normalizedAddress,
        contractName: name,
        tokenName: name,
        symbol: symbol,
        decimals: decimals,
        totalSupply: Number(totalSupply),
        ERC: 2, // ERC20 = 2
        verified: false,
      });
      await newContract.save();
      console.log(`📝 Added to Contract collection`);
    }

    console.log(`\n🎉 Token "${name}" (${symbol}) is now available in the explorer!`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

// Main entry point
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(`
Usage: npx ts-node tools/add-token.ts <token_address>

Example:
  npx ts-node tools/add-token.ts 0x52CB9F0d65D9d4De08CF103153C7A1A97567Bb9b

This tool manually adds an ERC20/VRC-20 token to the database.
`);
  process.exit(1);
}

addToken(args[0]);
