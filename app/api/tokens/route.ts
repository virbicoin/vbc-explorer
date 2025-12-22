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

// Address constants
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const DEAD_ADDR = '0x000000000000000000000000000000000000dead';

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

// Launchpad V2 Token ABI for logoUrl
const LAUNCHPAD_V2_ABI = [
  {
    "inputs": [],
    "name": "logoUrl",
    "outputs": [{"name": "", "type": "string"}],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

// Function to fetch logoUrl from Launchpad V2 token contract
async function fetchLaunchpadLogoUrl(tokenAddress: string): Promise<string | null> {
  try {
    const contract = new web3.eth.Contract(LAUNCHPAD_V2_ABI, tokenAddress);
    const logoUrl = await contract.methods.logoUrl().call();
    return logoUrl && logoUrl !== '' ? (logoUrl as string) : null;
  } catch {
    // Token doesn't have logoUrl method (not a Launchpad V2 token)
    return null;
  }
}

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
  verified: { type: Boolean, default: false },
  logoUrl: { type: String, default: null }
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
  logoUrl?: string;
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
  
  // Get all contracts (for verification status and ERC20 discovery)
  const contracts = await Contract.find({}).lean();
  const verificationMap = new Map();
  const contractMap = new Map();
  contracts.forEach(contract => {
    const addr = contract.address?.toLowerCase();
    if (addr) {
      verificationMap.set(addr, contract.verified || false);
      contractMap.set(addr, contract);
    }
  });

  // Fetch all tokens from the database
  let dbTokens = await Token.find({}).lean() as Record<string, unknown>[];
  
  // Get addresses already in tokens collection
  const existingTokenAddresses = new Set(
    dbTokens.map(t => (t.address as string)?.toLowerCase()).filter(Boolean)
  );
  
  // Add important tokens from config.json (DEX tokens) if not in database
  const configTokens: { address: string; name: string; symbol: string; decimals: number }[] = [];
  
  // Add wrapped native token (WVBC)
  if (config.dex?.wrappedNative) {
    const wn = config.dex.wrappedNative;
    if (wn.address && !existingTokenAddresses.has(wn.address.toLowerCase())) {
      configTokens.push({
        address: wn.address.toLowerCase(),
        name: wn.name || 'Wrapped Native',
        symbol: wn.symbol || 'WNATIVE',
        decimals: wn.decimals || 18,
      });
    }
  }
  
  // Add reward token (VBCG)
  if (config.dex?.rewardToken) {
    const rt = config.dex.rewardToken;
    if (rt.address && !existingTokenAddresses.has(rt.address.toLowerCase())) {
      configTokens.push({
        address: rt.address.toLowerCase(),
        name: rt.name || 'Reward Token',
        symbol: rt.symbol || 'REWARD',
        decimals: rt.decimals || 18,
      });
    }
  }
  
  // Add other DEX tokens (USDT, etc.)
  if (config.dex?.tokens) {
    for (const [, token] of Object.entries(config.dex.tokens)) {
      const t = token as { address?: string; name?: string; symbol?: string; decimals?: number };
      if (t.address && !existingTokenAddresses.has(t.address.toLowerCase())) {
        configTokens.push({
          address: t.address.toLowerCase(),
          name: t.name || 'Unknown',
          symbol: t.symbol || 'UNKNOWN',
          decimals: t.decimals || 18,
        });
      }
    }
  }
  
  // Add config tokens to the list
  for (const ct of configTokens) {
    // Try to get real-time supply from blockchain
    let actualSupply = '0';
    try {
      const contract = new web3.eth.Contract(ERC20_ABI, ct.address);
      const rawSupply = await contract.methods.totalSupply().call();
      if (rawSupply) {
        const value = BigInt(String(rawSupply));
        const divisor = BigInt(10 ** ct.decimals);
        const integerPart = value / divisor;
        actualSupply = Number(integerPart).toLocaleString();
      }
    } catch {
      // Ignore errors, keep default supply
    }
    
    const tokenEntry = {
      address: ct.address,
      name: ct.name,
      symbol: ct.symbol,
      decimals: ct.decimals,
      totalSupply: actualSupply,
      holders: 0,
      type: 'VRC-20',
      supply: actualSupply,
      verified: verificationMap.get(ct.address) || false,
    };
    dbTokens.push(tokenEntry as Record<string, unknown>);
    existingTokenAddresses.add(ct.address);
  }
  
  // Find ERC20 contracts not in tokens collection and add them
  // ERC: 2 = ERC20 in Contract collection
  const missingErc20Contracts = contracts.filter(c => {
    const addr = c.address?.toLowerCase();
    return addr && 
           (c.ERC === 2 || c.symbol) &&  // ERC20 or has symbol (likely token)
           !existingTokenAddresses.has(addr);
  });
  
  // Add missing ERC20 contracts to the token list dynamically
  for (const contract of missingErc20Contracts) {
    const tokenEntry = {
      address: contract.address?.toLowerCase(),
      name: contract.tokenName || contract.contractName || 'Unknown',
      symbol: contract.symbol || 'UNKNOWN',
      decimals: contract.decimals || 18,
      totalSupply: contract.totalSupply?.toString() || '0',
      holders: 0,
      type: 'VRC-20',
      supply: contract.totalSupply?.toString() || '0',
      verified: contract.verified || false,
    };
    dbTokens.push(tokenEntry as Record<string, unknown>);
  }

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
    logoUrl: config.currency?.icon ? `https://explorer.digitalregion.jp${config.currency.icon}` : undefined,
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
      // For VRC-20 tokens, fetch real-time totalSupply and holder count
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

        // Get actual holder count from tokenholders collection (exclude zero and dead addresses)
        try {
          const TokenHolder = mongoose.models.TokenHolder || mongoose.model('TokenHolder', new mongoose.Schema({
            tokenAddress: String,
            holderAddress: String,
            balance: String,
          }, { collection: 'tokenholders' }));

          actualHolders = await TokenHolder.countDocuments({
            tokenAddress: { $regex: new RegExp(`^${token.address}$`, 'i') },
            holderAddress: { $nin: [ZERO_ADDR, DEAD_ADDR] }
          });
        } catch (err) {
          console.error(`Error fetching holder count for ${token.address}:`, err);
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
          holderAddress: { $nin: [ZERO_ADDR, DEAD_ADDR] }
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
    
    // Get logo URL from config or database
    const tokenAddr = typeof token.address === 'string' ? token.address.toLowerCase() : '';
    const tokenLogos = (config as { tokenLogos?: Record<string, string> }).tokenLogos || {};
    const configLogoUrl = tokenLogos[tokenAddr] || null;
    const dbLogoUrl = typeof token.logoUrl === 'string' ? token.logoUrl : null;
    const logoUrl = dbLogoUrl || configLogoUrl;
    
    return { 
      ...token, 
      type,
      holders: actualHolders,
      supply: actualSupply,
      verified: verificationStatus !== null ? verificationStatus : false,
      logoUrl: logoUrl
    };
  }));

  // Include all valid tokens from the tokens collection (exclude tokens with 0 holders)
  const filteredTokens = (normalizedTokens as (IToken | Record<string, unknown>)[]).filter((t): t is IToken => {
    if (!('address' in t) || typeof t.address !== 'string') return false;
    const addr = t.address.toLowerCase();
    // Only validate address format, don't require Contract collection entry
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return false;
    // Exclude tokens with 0 holders
    const holders = (t as IToken).holders ?? 0;
    return holders > 0;
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
