import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import Web3 from 'web3';
import { connectDB } from '../../../../models/index';
import { loadConfig } from '../../../../lib/config';

// Load configuration
const config = loadConfig();
const RPC_URL = config.web3Provider?.url || 'http://localhost:8545';
const web3 = new Web3(RPC_URL);

// TokenFactory ABI (only what we need)
const TokenFactoryABI = [
  {
    inputs: [],
    name: 'getAllTokens',
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'token', type: 'address' }],
    name: 'tokenInfo',
    outputs: [
      { name: 'creator', type: 'address' },
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'decimals', type: 'uint8' },
      { name: 'totalSupply', type: 'uint256' },
      { name: 'createdAt', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ERC20 ABI for token info
const ERC20_ABI = [
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
] as const;

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
  verified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  createdBy: String,
  source: String,
}, { collection: 'tokens' });

const Token = mongoose.models.Token || mongoose.model('Token', tokenSchema);

// TokenHolder schema
const tokenHolderSchema = new mongoose.Schema({
  tokenAddress: String,
  holderAddress: String,
  balance: String,
  rank: { type: Number, default: 1 },
  percentage: { type: Number, default: 100 },
}, { collection: 'tokenholders' });

const TokenHolder = mongoose.models.TokenHolder || mongoose.model('TokenHolder', tokenHolderSchema);

// GET - Sync all tokens from TokenFactory to database
export async function GET(request: NextRequest) {
  try {
    const launchpadConfig = config.launchpad;
    const factoryAddress = launchpadConfig?.factoryAddress;

    if (!factoryAddress || factoryAddress === '0x0000000000000000000000000000000000000000') {
      return NextResponse.json({
        success: false,
        error: 'TokenFactory not configured'
      }, { status: 400 });
    }

    await connectDB();

    // Get all tokens from factory
    const factory = new web3.eth.Contract(TokenFactoryABI, factoryAddress);
    const allTokens = await factory.methods.getAllTokens().call() as string[];

    console.log(`Found ${allTokens.length} tokens in TokenFactory`);

    const results = {
      total: allTokens.length,
      registered: 0,
      skipped: 0,
      errors: 0,
      tokens: [] as { address: string; symbol: string; status: string }[]
    };

    for (const tokenAddress of allTokens) {
      try {
        // Check if already registered
        const existing = await Token.findOne({
          address: { $regex: new RegExp(`^${tokenAddress}$`, 'i') }
        });

        if (existing) {
          results.skipped++;
          results.tokens.push({ address: tokenAddress, symbol: existing.symbol, status: 'skipped' });
          continue;
        }

        // Get token info directly from ERC20 contract
        const tokenContract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
        
        let name = 'Unknown';
        let symbol = 'UNKNOWN';
        let decimals = 18;
        let totalSupply = '0';

        try {
          name = await tokenContract.methods.name().call() as string;
        } catch (e) { /* ignore */ }

        try {
          symbol = await tokenContract.methods.symbol().call() as string;
        } catch (e) { /* ignore */ }

        try {
          decimals = Number(await tokenContract.methods.decimals().call());
        } catch (e) { /* ignore */ }

        try {
          totalSupply = String(await tokenContract.methods.totalSupply().call());
        } catch (e) { /* ignore */ }

        // Create token record
        const newToken = new Token({
          address: tokenAddress.toLowerCase(),
          name,
          symbol,
          decimals,
          totalSupply,
          supply: totalSupply,
          holders: 0,
          type: 'VRC-20',
          verified: false,
          createdAt: new Date(),
          source: 'launchpad'
        });

        await newToken.save();

        results.registered++;
        results.tokens.push({ address: tokenAddress, symbol, status: 'registered' });
        console.log(`✅ Registered: ${symbol} (${tokenAddress})`);

      } catch (err) {
        results.errors++;
        results.tokens.push({ address: tokenAddress, symbol: 'unknown', status: 'error' });
        console.error(`❌ Error registering ${tokenAddress}:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Sync completed: ${results.registered} registered, ${results.skipped} skipped, ${results.errors} errors`,
      results
    });

  } catch (error) {
    console.error('Error syncing tokens:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to sync tokens',
      details: String(error)
    }, { status: 500 });
  }
}
