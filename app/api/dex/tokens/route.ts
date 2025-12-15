import { NextResponse } from 'next/server';
import { connectDB } from '@/models/index';
import mongoose from 'mongoose';
import Web3 from 'web3';
import { loadConfig } from '@/lib/config';

// Load configuration
const config = loadConfig();
const RPC_URL = config.web3Provider?.url || 'http://localhost:8329';

// DEX Contract addresses
const DEX_FACTORY = '0xE85A5BF52711c1eD2e94C8d6c8ba6717e70FE94F';
const WVBC_ADDRESS = '0x52CB9F0d65D9d4De08CF103153C7A1A97567Bb9b'.toLowerCase();

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

// Fixed tokens (VBC is always available as native token)
const VBC_TOKEN: DexToken = {
  address: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  name: 'VirBiCoin',
  symbol: 'VBC',
  decimals: 18,
};

const WVBC_TOKEN: DexToken = {
  address: '0x52CB9F0d65D9d4De08CF103153C7A1A97567Bb9b' as `0x${string}`,
  name: 'Wrapped VBC',
  symbol: 'WVBC',
  decimals: 18,
};

// Get all tokens that have pairs in the DEX
async function getTokensWithPairs(): Promise<Set<string>> {
  const web3 = new Web3(RPC_URL);
  const tokensWithPairs = new Set<string>();
  
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
    
    // If WVBC is in a pair, also add VBC (native token, address 0x0)
    if (tokensWithPairs.has(WVBC_ADDRESS)) {
      tokensWithPairs.add('0x0000000000000000000000000000000000000000');
    }
    
  } catch (error) {
    console.error('Error fetching pairs from factory:', error);
  }
  
  return tokensWithPairs;
}

export async function GET() {
  try {
    // Get tokens that have pairs
    const tokensWithPairs = await getTokensWithPairs();
    
    if (tokensWithPairs.size === 0) {
      // If no pairs found, return VBC and WVBC as fallback
      return NextResponse.json({
        tokens: [VBC_TOKEN, WVBC_TOKEN],
        total: 2,
        message: 'No pairs found in DEX'
      });
    }
    
    await connectDB();
    const db = mongoose.connection.db;
    
    const resultTokens: DexToken[] = [];
    
    // Always add VBC if WVBC has pairs
    if (tokensWithPairs.has('0x0000000000000000000000000000000000000000') || 
        tokensWithPairs.has(WVBC_ADDRESS)) {
      resultTokens.push(VBC_TOKEN);
    }
    
    // Always add WVBC if it has pairs
    if (tokensWithPairs.has(WVBC_ADDRESS)) {
      resultTokens.push(WVBC_TOKEN);
    }
    
    if (db) {
      // Get token info from database for tokens that have pairs
      const pairTokenAddresses = Array.from(tokensWithPairs)
        .filter(addr => addr !== '0x0000000000000000000000000000000000000000' && 
                        addr !== WVBC_ADDRESS);
      
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
    // Return VBC and WVBC as fallback on error
    return NextResponse.json({
      tokens: [VBC_TOKEN, WVBC_TOKEN],
      total: 2,
      error: 'Failed to fetch tokens'
    });
  }
}
