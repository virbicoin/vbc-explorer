import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import Web3 from 'web3';
import { connectDB } from '../../../../models/index';
import { loadConfig } from '../../../../lib/config';

// Load configuration
const config = loadConfig();
const RPC_URL = config.web3Provider?.url || 'http://localhost:8545';
const web3 = new Web3(RPC_URL);

// ERC20 ABI for fetching token info
const ERC20_ABI = [
  {
    "inputs": [],
    "name": "name",
    "outputs": [{ "name": "", "type": "string" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "symbol",
    "outputs": [{ "name": "", "type": "string" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "decimals",
    "outputs": [{ "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalSupply",
    "outputs": [{ "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
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
  createdBy: String, // Creator address
  source: String, // 'launchpad' or 'scan'
}, { collection: 'tokens' });

const Token = mongoose.models.Token || mongoose.model('Token', tokenSchema);

// TokenHolder schema for initial holder registration
const tokenHolderSchema = new mongoose.Schema({
  tokenAddress: String,
  holderAddress: String,
  balance: String,
  rank: { type: Number, default: 1 },
  percentage: { type: Number, default: 100 },
}, { collection: 'tokenholders' });

const TokenHolder = mongoose.models.TokenHolder || mongoose.model('TokenHolder', tokenHolderSchema);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tokenAddress, creator } = body;

    if (!tokenAddress) {
      return NextResponse.json(
        { error: 'Token address is required' },
        { status: 400 }
      );
    }

    // Validate address format
    if (!web3.utils.isAddress(tokenAddress)) {
      return NextResponse.json(
        { error: 'Invalid token address format' },
        { status: 400 }
      );
    }

    await connectDB();

    // Check if token already exists
    const existingToken = await Token.findOne({
      address: { $regex: new RegExp(`^${tokenAddress}$`, 'i') }
    });

    if (existingToken) {
      return NextResponse.json({
        success: true,
        message: 'Token already registered',
        token: existingToken
      });
    }

    // Fetch token info from blockchain
    const contract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
    
    let name = 'Unknown';
    let symbol = 'UNKNOWN';
    let decimals = 18;
    let totalSupply = '0';

    try {
      name = await contract.methods.name().call() as string;
    } catch (e) {
      console.error('Failed to fetch token name:', e);
    }

    try {
      symbol = await contract.methods.symbol().call() as string;
    } catch (e) {
      console.error('Failed to fetch token symbol:', e);
    }

    try {
      decimals = Number(await contract.methods.decimals().call());
    } catch (e) {
      console.error('Failed to fetch token decimals:', e);
    }

    try {
      totalSupply = String(await contract.methods.totalSupply().call());
    } catch (e) {
      console.error('Failed to fetch token totalSupply:', e);
    }

    // Create new token record
    const newToken = new Token({
      address: tokenAddress.toLowerCase(),
      name,
      symbol,
      decimals,
      totalSupply,
      supply: totalSupply,
      holders: creator ? 1 : 0, // Creator is initial holder
      type: 'VRC-20',
      verified: false,
      createdAt: new Date(),
      createdBy: creator?.toLowerCase() || null,
      source: 'launchpad'
    });

    await newToken.save();

    // Register creator as initial holder if provided
    if (creator && totalSupply !== '0') {
      const existingHolder = await TokenHolder.findOne({
        tokenAddress: tokenAddress.toLowerCase(),
        holderAddress: creator.toLowerCase()
      });

      if (!existingHolder) {
        const newHolder = new TokenHolder({
          tokenAddress: tokenAddress.toLowerCase(),
          holderAddress: creator.toLowerCase(),
          balance: totalSupply,
          rank: 1,
          percentage: 100
        });
        await newHolder.save();
      }
    }

    console.log(`✅ Registered new launchpad token: ${symbol} (${tokenAddress})`);

    return NextResponse.json({
      success: true,
      message: 'Token registered successfully',
      token: {
        address: tokenAddress.toLowerCase(),
        name,
        symbol,
        decimals,
        totalSupply,
        type: 'VRC-20'
      }
    });

  } catch (error) {
    console.error('Error registering token:', error);
    return NextResponse.json(
      { error: 'Failed to register token', details: String(error) },
      { status: 500 }
    );
  }
}
