import { NextResponse } from 'next/server';
import { connectDB } from '@/models/index';
import mongoose from 'mongoose';
import Web3 from 'web3';
import { loadConfig } from '@/lib/config';
import { fetchDexConfig, setMinimalConfig, getNativeToken } from '@/lib/dex/contract-service';

// Load blacklist from config
const config = loadConfig();
const blacklistConfig = (config as { blacklist?: { tokens?: { address: string }[], lpPairs?: { address: string }[] } }).blacklist || {};
const BLACKLISTED_TOKENS = (blacklistConfig.tokens || []).map(t => t.address.toLowerCase());
const BLACKLISTED_LP_PAIRS = (blacklistConfig.lpPairs || []).map(p => p.address.toLowerCase());

// Helper function to check if address is blacklisted
const isBlacklisted = (address: string): boolean => {
  const addr = address.toLowerCase();
  return BLACKLISTED_TOKENS.includes(addr) || BLACKLISTED_LP_PAIRS.includes(addr);
};

// Router ABI to get factory address
const ROUTER_ABI = [
  {
    inputs: [],
    name: "factory",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "WETH",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "WVBC",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  }
];

// Factory ABI for getting pairs
const FACTORY_ABI = [
  {
    inputs: [],
    name: "allPairsLength",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ name: "", type: "uint256" }],
    name: "allPairs",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  }
];

// Pair ABI for getting tokens
const PAIR_ABI = [
  {
    inputs: [],
    name: "token0",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "token1",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  }
];

// Token interface for DEX
interface DexToken {
  address: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  verified?: boolean;
  holders?: number;
}

// Get all tokens that have pairs in the DEX (dynamically fetches factory from router)
async function getTokensWithPairs(appConfig: ReturnType<typeof loadConfig>): Promise<{ tokens: Set<string>, wrappedNativeAddress: string }> {
  const RPC_URL = appConfig.network?.rpcUrl || appConfig.web3Provider?.url || 'http://localhost:8545';
  const web3 = new Web3(RPC_URL);
  const tokensWithPairs = new Set<string>();
  
  // Set minimal config for dex service
  setMinimalConfig({
    chainId: appConfig.network?.chainId || 1,
    rpcUrl: RPC_URL,
    explorer: appConfig.network?.explorer || 'https://etherscan.io',
    routerV2: (appConfig.dex?.router || '0x0000000000000000000000000000000000000000') as `0x${string}`,
    masterChefV2: (appConfig.dex?.masterChef || '0x0000000000000000000000000000000000000000') as `0x${string}`,
  });
  
  // Fetch dynamic config from blockchain
  const dexConfig = await fetchDexConfig();
  const DEX_FACTORY = dexConfig.factory;
  const WRAPPED_NATIVE_ADDRESS = dexConfig.wrappedNative.toLowerCase();
  
  try {
    const factory = new web3.eth.Contract(FACTORY_ABI, DEX_FACTORY);
    
    // Get total number of pairs
    const pairsLength = await factory.methods.allPairsLength().call();
    const numPairs = Number(pairsLength);
    
    console.log(`Found ${numPairs} pairs in DEX factory`);
    
    // Get all pairs and extract tokens
    for (let i = 0; i < numPairs; i++) {
      try {
        const pairAddress = await factory.methods.allPairs(i).call() as string;
        const pair = new web3.eth.Contract(PAIR_ABI, pairAddress);
        
        const [token0, token1] = await Promise.all([
          pair.methods.token0().call(),
          pair.methods.token1().call()
        ]);
        
        // Add both tokens to the set (lowercase for consistency)
        tokensWithPairs.add(String(token0).toLowerCase());
        tokensWithPairs.add(String(token1).toLowerCase());
      } catch (pairError) {
        console.error(`Error getting pair ${i}:`, pairError);
      }
    }
    
    // If wrapped native is in a pair, also add native token (address 0x0)
    if (tokensWithPairs.has(WRAPPED_NATIVE_ADDRESS)) {
      tokensWithPairs.add('0x0000000000000000000000000000000000000000');
    }
    
  } catch (error) {
    console.error('Error fetching pairs from factory:', error);
  }
  
  return { tokens: tokensWithPairs, wrappedNativeAddress: WRAPPED_NATIVE_ADDRESS };
}

export async function GET() {
  try {
    // Load configuration
    const appConfig = loadConfig();
    
    // Check if DEX is enabled
    if (!appConfig.dex?.enabled) {
      return NextResponse.json({
        tokens: [],
        total: 0,
        message: 'DEX feature is not enabled'
      });
    }
    
    // Get native token info from config
    const nativeToken = getNativeToken(appConfig.currency);
    
    // Get tokens that have pairs (also returns wrapped native address)
    const { tokens: tokensWithPairs, wrappedNativeAddress } = await getTokensWithPairs(appConfig);
    
    if (tokensWithPairs.size === 0) {
      // If no pairs found, return only native token as fallback
      return NextResponse.json({
        tokens: [nativeToken],
        total: 1,
        message: 'No pairs found in DEX'
      });
    }
    await connectDB();
    const db = mongoose.connection.db;
    
    const resultTokens: DexToken[] = [];
    
    // Always add native token if wrapped native has pairs
    if (tokensWithPairs.has('0x0000000000000000000000000000000000000000') || 
        tokensWithPairs.has(wrappedNativeAddress)) {
      resultTokens.push(nativeToken);
    }
    
    // Don't show wrapped native - users interact with native directly and 
    // the router automatically wraps/unwraps as needed
    
    if (db) {
      // Get token info from database for tokens that have pairs
      // Exclude wrapped native (we show native instead) and blacklisted tokens
      const pairTokenAddresses = Array.from(tokensWithPairs)
        .filter(addr => addr !== '0x0000000000000000000000000000000000000000' && 
                        addr !== wrappedNativeAddress &&
                        !isBlacklisted(addr));
      
      if (pairTokenAddresses.length > 0) {
        const dbTokens = await db.collection('tokens').find({
          address: { $in: pairTokenAddresses }
        }).toArray();
        
        for (const token of dbTokens) {
          resultTokens.push({
            address: token.address as `0x${string}`,
            name: token.name || 'Unknown Token',
            symbol: token.symbol || '???',
            decimals: token.decimals || 18,
            verified: token.verified || false,
            holders: token.holders || 0,
          });
        }
        
        // For tokens in pairs but not in DB, add with basic info
        for (const addr of pairTokenAddresses) {
          const inDb = dbTokens.some(t => t.address.toLowerCase() === addr.toLowerCase());
          if (!inDb) {
            resultTokens.push({
              address: addr as `0x${string}`,
              name: 'Unknown Token',
              symbol: '???',
              decimals: 18,
            });
          }
        }
      }
    }

    return NextResponse.json({
      tokens: resultTokens,
      total: resultTokens.length,
      pairsCount: tokensWithPairs.size
    });
  } catch (error) {
    console.error('Error fetching DEX tokens:', error);
    // Return empty list on error
    return NextResponse.json({
      tokens: [],
      total: 0,
      error: 'Failed to fetch tokens'
    });
  }
}
