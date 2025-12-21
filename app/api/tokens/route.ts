import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import Web3 from 'web3';
import { getChainStats } from '../../../lib/stats'; // Import the stats function
import { Contract, connectDB } from '../../../models/index';
import { loadConfig } from '../../../lib/config';

// Load configuration for Web3
const config = loadConfig();
const RPC_URL = config.web3Provider?.url || 'http://localhost:8545';
const web3 = new Web3(RPC_URL);

// ERC20 ABI for totalSupply
const ERC20_ABI = [
  {
    "inputs": [],
    "name": "totalSupply",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

// Define Token schema inline since it's not exported from models/index
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

// Define the structure of a token, including the optional fields
interface IToken {
  address: string;
  name: string;
  symbol: string;
  decimals?: number;
  totalSupply?: string;
  holders?: number;
  type: 'Native' | 'VRC-20' | 'VRC-721' | 'VRC-1155';
  supply?: string;
  verified?: boolean;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')));
  const type = searchParams.get('type'); // 'all', 'vrc20', 'nft'
  
  await connectDB();
  
  // Load config for native token info
  const config = loadConfig();
  const nativeTokenName = config.currency?.name || 'Ether';
  const nativeTokenSymbol = config.currency?.symbol || 'ETH';
  
  // Get verification status for all contracts
  const contracts = await Contract.find({}).lean();
  const verificationMap = new Map();
  contracts.forEach(contract => {
    verificationMap.set(contract.address.toLowerCase(), contract.verified || false);
  });


  // Fetch all tokens from the database
  const dbTokens = await Token.find({}).lean() as Record<string, unknown>[];

  // Get actual chain statistics for native token
  const chainStats = await getChainStats();

  // Manually create and add the native token with real stats
  const nativeToken: IToken = {
    address: 'N/A', // Native token has no contract address
    name: nativeTokenName,
    symbol: nativeTokenSymbol,
    type: 'Native',
    holders: chainStats.activeAddresses || 0, // Real wallet count
    supply: chainStats.totalSupply || 'unlimited', // Real total supply
  };

  // Normalize token types and update with real statistics
  const normalizedTokens = await Promise.all(dbTokens.map(async (token: Record<string, unknown>) => {
    let type = token.type;
    if (type === 'ERC20') {
      type = 'VRC-20';
    } else if (type === 'ERC721') {
      type = 'VRC-721';
    } else if (type === 'VRC721') {
      type = 'VRC-721';
    } else if (type === 'ERC1155') {
      type = 'VRC-1155';
    } else if (type === 'VRC1155') {
      type = 'VRC-1155';
    }

    // Get actual holder count and supply for each token
    let actualHolders = token.holders || 0;
    let actualSupply = token.supply || token.totalSupply || '0';
    const decimals = typeof token.decimals === 'number' ? token.decimals : 18;

    try {
      // For VRC-20 tokens, fetch real-time totalSupply from blockchain
      if (type === 'VRC-20' && token.address && typeof token.address === 'string') {
        try {
          const contract = new web3.eth.Contract(ERC20_ABI, token.address as string);
          const rawSupply = await contract.methods.totalSupply().call();
          if (rawSupply) {
            // Format with decimals
            const value = BigInt(String(rawSupply));
            const divisor = BigInt(10 ** decimals);
            const integerPart = value / divisor;
            const fractionalPart = value % divisor;
            
            if (fractionalPart === BigInt(0)) {
              actualSupply = Number(integerPart).toLocaleString();
            } else {
              const formatted = Number(value) / Number(divisor);
              const decimalStr = formatted.toFixed(6).replace(/\.?0+$/, '');
              const parts = decimalStr.split('.');
              parts[0] = Number(parts[0]).toLocaleString();
              actualSupply = parts.join('.');
            }
          }
        } catch (err) {
          console.error(`Error fetching totalSupply for ${token.address}:`, err);
        }
      }

      // For VRC-721 token, get actual statistics
      if (type === 'VRC-721') {
        // Get holder count from tokenholders collection (exclude zero address)
        const TokenHolder = mongoose.models.TokenHolder || mongoose.model('TokenHolder', new mongoose.Schema({
          tokenAddress: String,
          holderAddress: String,
          balance: String,
        }, { collection: 'tokenholders' }));

        actualHolders = await TokenHolder.countDocuments({
          tokenAddress: { $regex: new RegExp(`^${token.address}$`, 'i') },
          holderAddress: { $ne: '0x0000000000000000000000000000000000000000' }
        });

        // Use database totalSupply if available, otherwise calculate from transfers
        if (!token.totalSupply || token.totalSupply === '0') {
          // For NFTs, total supply is the total number of minted tokens
          const TokenTransfer = mongoose.models.TokenTransfer || mongoose.model('TokenTransfer', new mongoose.Schema({
            tokenAddress: String,
            from: String,
            to: String,
          }, { collection: 'tokentransfers' }));

          // Count minting transactions (from address 0x0000...)
          const mintCount = await TokenTransfer.countDocuments({
            tokenAddress: { $regex: new RegExp(`^${token.address}$`, 'i') },
            from: '0x0000000000000000000000000000000000000000'
          });

          actualSupply = mintCount.toString();
        } else {
          actualSupply = token.totalSupply;
        }
      }
    } catch (error) {
      console.error(`Error getting stats for token ${token.address}:`, error);
    }

    const verificationStatus = typeof token.address === 'string' ? verificationMap.get(token.address.toLowerCase()) : null;
    
    return { 
      ...token, 
      type,
      holders: actualHolders,
      supply: actualSupply,
      verified: verificationStatus !== null ? verificationStatus : false
    };
  }));

  // Include all valid tokens from the tokens collection
  const filteredTokens = (normalizedTokens as (IToken | Record<string, unknown>)[]).filter((t): t is IToken => {
    if (!('address' in t) || typeof t.address !== 'string') return false;
    const addr = t.address.toLowerCase();
    // Only validate address format, don't require Contract collection entry
    return /^0x[0-9a-fA-F]{40}$/.test(addr);
  });

  // Combine the native token with the database tokens
  let allTokens = [nativeToken, ...filteredTokens];
  
  // Filter by type if specified
  if (type === 'vrc20') {
    allTokens = allTokens.filter(t => t.type === 'Native' || t.type === 'VRC-20');
  } else if (type === 'nft') {
    allTokens = allTokens.filter(t => 
      (t.type === 'VRC-721' || t.type === 'VRC-1155') &&
      ((t.holders ?? 0) > 0 || (t.supply && t.supply !== '0' && t.supply !== ''))
    );
  }
  
  // Calculate pagination
  const total = allTokens.length;
  const totalPages = Math.ceil(total / limit);
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const paginatedTokens = allTokens.slice(startIndex, endIndex);

  return NextResponse.json({ 
    tokens: paginatedTokens,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages
    }
  });
}
