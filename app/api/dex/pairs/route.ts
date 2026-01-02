// API endpoint to get DEX trading pairs with current prices
import { NextResponse } from 'next/server';
import Web3 from 'web3';
import { loadConfig } from '@/lib/config';
import { fetchDexConfig, setMinimalConfig, getNativeToken } from '@/lib/dex/contract-service';
import dbConnect from '@/lib/db';
import mongoose from 'mongoose';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Load blacklist from config
const config = loadConfig();
const blacklistConfig =
  (config as { blacklist?: { tokens?: { address: string }[]; lpPairs?: { address: string }[] } })
    .blacklist || {};
const BLACKLISTED_TOKENS = (blacklistConfig.tokens || []).map((t) => t.address.toLowerCase());
const BLACKLISTED_LP_PAIRS = (blacklistConfig.lpPairs || []).map((p) => p.address.toLowerCase());

// Helper function to check if address is blacklisted
const isBlacklisted = (address: string): boolean => {
  const addr = address.toLowerCase();
  return BLACKLISTED_TOKENS.includes(addr) || BLACKLISTED_LP_PAIRS.includes(addr);
};

// ABIs
const FACTORY_ABI = [
  {
    inputs: [],
    name: 'allPairsLength',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: '', type: 'uint256' }],
    name: 'allPairs',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const PAIR_ABI = [
  {
    inputs: [],
    name: 'token0',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getReserves',
    outputs: [
      { name: 'reserve0', type: 'uint256' },
      { name: 'reserve1', type: 'uint256' },
    ],
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
];

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
];

interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
}

interface PairInfo {
  id: string;
  address: string;
  name: string;
  baseToken: TokenInfo;
  quoteToken: TokenInfo;
  reserve0: string;
  reserve1: string;
  price: number;
  priceInverse: number;
  liquidity: string;
}

// Token info cache (without logoURI)
const tokenCache = new Map<string, TokenInfo>();
// Logo URI cache from database
const logoCache = new Map<string, string | null>();

async function getTokenInfo(
  web3: Web3,
  address: string,
  nativeToken?: { symbol: string; name: string },
  wrappedNativeAddress?: string
): Promise<TokenInfo> {
  const lowerAddress = address.toLowerCase();

  // Check cache first
  if (tokenCache.has(lowerAddress)) {
    return tokenCache.get(lowerAddress)!;
  }

  try {
    const contract = new web3.eth.Contract(ERC20_ABI, address);
    const [nameResult, symbolResult, decimalsResult] = await Promise.all([
      contract.methods.name().call(),
      contract.methods.symbol().call(),
      contract.methods.decimals().call(),
    ]);

    const name = String(nameResult);
    const symbol = String(symbolResult);

    // Check if this is wrapped native token
    let displaySymbol = symbol;
    let displayName = name;

    if (wrappedNativeAddress && lowerAddress === wrappedNativeAddress.toLowerCase()) {
      // Use native token symbol for display (e.g., show "VBC" instead of "WVBC")
      if (nativeToken) {
        displaySymbol = nativeToken.symbol;
        displayName = nativeToken.name;
      }
    }

    const tokenInfo: TokenInfo = {
      address: lowerAddress,
      name: displayName,
      symbol: displaySymbol,
      decimals: Number(decimalsResult),
    };

    tokenCache.set(lowerAddress, tokenInfo);
    return tokenInfo;
  } catch (error) {
    console.error(`Error fetching token info for ${address}:`, error);
    return {
      address: lowerAddress,
      name: 'Unknown',
      symbol: 'UNKNOWN',
      decimals: 18,
    };
  }
}

export async function GET() {
  try {
    const appConfig = loadConfig();

    if (!appConfig.dex?.enabled) {
      return NextResponse.json(
        { success: false, error: 'DEX feature is not enabled' },
        { status: 404 }
      );
    }

    const RPC_URL =
      appConfig.network?.rpcUrl || appConfig.web3Provider?.url || 'http://localhost:8545';
    const web3 = new Web3(RPC_URL);

    // Set minimal config
    setMinimalConfig({
      chainId: appConfig.network?.chainId || 1,
      rpcUrl: RPC_URL,
      explorer: appConfig.network?.explorer || 'https://etherscan.io',
      routerV2: (appConfig.dex?.router ||
        '0x0000000000000000000000000000000000000000') as `0x${string}`,
      masterChefV2: (appConfig.dex?.masterChef ||
        '0x0000000000000000000000000000000000000000') as `0x${string}`,
    });

    // Fetch DEX config from blockchain
    const dexConfig = await fetchDexConfig();
    const factoryAddress = dexConfig.factory;
    const wrappedNativeAddress = dexConfig.wrappedNative.toLowerCase();

    // Get native token info
    const nativeToken = getNativeToken(appConfig.currency);

    const factory = new web3.eth.Contract(FACTORY_ABI, factoryAddress);
    const pairsLength = await factory.methods.allPairsLength().call();
    const numPairs = Number(pairsLength);

    const pairs: PairInfo[] = [];

    // Fetch all pairs (limit to 50 for performance)
    const maxPairs = Math.min(numPairs, 50);

    for (let i = 0; i < maxPairs; i++) {
      try {
        const pairAddressResult = await factory.methods.allPairs(i).call();
        const pairAddress = String(pairAddressResult);

        // Skip blacklisted LP pairs
        if (isBlacklisted(pairAddress)) {
          continue;
        }

        const pairContract = new web3.eth.Contract(PAIR_ABI, pairAddress);

        const [token0AddressResult, token1AddressResult, reservesResult, totalSupplyResult] =
          await Promise.all([
            pairContract.methods.token0().call(),
            pairContract.methods.token1().call(),
            pairContract.methods.getReserves().call(),
            pairContract.methods.totalSupply().call(),
          ]);

        const token0Address = String(token0AddressResult);
        const token1Address = String(token1AddressResult);

        // Skip pairs containing blacklisted tokens
        if (isBlacklisted(token0Address) || isBlacklisted(token1Address)) {
          continue;
        }

        const reserves = reservesResult as unknown as { reserve0: string; reserve1: string };
        const totalSupply = totalSupplyResult ? String(totalSupplyResult) : '0';

        // Skip pairs with zero liquidity
        const reserve0 = BigInt(reserves.reserve0);
        const reserve1 = BigInt(reserves.reserve1);

        if (reserve0 === 0n || reserve1 === 0n) {
          continue;
        }

        // Get token info
        const [token0, token1] = await Promise.all([
          getTokenInfo(web3, token0Address, nativeToken, wrappedNativeAddress),
          getTokenInfo(web3, token1Address, nativeToken, wrappedNativeAddress),
        ]);

        // Calculate price (token1 per token0)
        const decimals0 = token0.decimals;
        const decimals1 = token1.decimals;

        // Price = (reserve1 / 10^decimals1) / (reserve0 / 10^decimals0)
        const price0 = (Number(reserve1) / Number(reserve0)) * Math.pow(10, decimals0 - decimals1);
        const price1 = (Number(reserve0) / Number(reserve1)) * Math.pow(10, decimals1 - decimals0);

        // Determine base/quote token (prefer native token as quote)
        let baseToken: TokenInfo;
        let quoteToken: TokenInfo;
        let price: number;
        let priceInverse: number;
        let baseReserve: string;
        let quoteReserve: string;

        // Check if token0 is wrapped native
        const token0IsWrappedNative = token0.address === wrappedNativeAddress;
        const token1IsWrappedNative = token1.address === wrappedNativeAddress;

        if (token0IsWrappedNative) {
          // token0 is native (quote), token1 is base
          baseToken = token1;
          quoteToken = token0;
          price = price1;
          priceInverse = price0;
          baseReserve = reserve1.toString();
          quoteReserve = reserve0.toString();
        } else if (token1IsWrappedNative) {
          // token1 is native (quote), token0 is base
          baseToken = token0;
          quoteToken = token1;
          price = price0;
          priceInverse = price1;
          baseReserve = reserve0.toString();
          quoteReserve = reserve1.toString();
        } else {
          // Neither is native, use token0 as base
          baseToken = token0;
          quoteToken = token1;
          price = price0;
          priceInverse = price1;
          baseReserve = reserve0.toString();
          quoteReserve = reserve1.toString();
        }

        pairs.push({
          id: `${baseToken.symbol.toLowerCase()}-${quoteToken.symbol.toLowerCase()}`,
          address: pairAddress.toLowerCase(),
          name: `${baseToken.symbol}/${quoteToken.symbol}`,
          baseToken,
          quoteToken,
          reserve0: baseReserve,
          reserve1: quoteReserve,
          price,
          priceInverse,
          liquidity: totalSupply,
        });
      } catch (error) {
        console.error(`Error fetching pair ${i}:`, error);
        continue;
      }
    }

    // Fetch logo URIs from database for all tokens
    try {
      await dbConnect();
      const db = mongoose.connection.db;
      if (db) {
        // Collect all unique token addresses
        const tokenAddresses = new Set<string>();
        for (const pair of pairs) {
          tokenAddresses.add(pair.baseToken.address.toLowerCase());
          tokenAddresses.add(pair.quoteToken.address.toLowerCase());
        }

        // Fetch contracts with image_url from database
        const contracts = await db
          .collection('contracts')
          .find({
            address: { $in: Array.from(tokenAddresses) },
            image_url: { $exists: true, $ne: null },
          })
          .toArray();

        // Build logo cache
        const logoMap = new Map<string, string>();
        for (const contract of contracts) {
          if (contract.image_url) {
            logoMap.set(contract.address.toLowerCase(), contract.image_url);
          }
        }

        // Update token info with logo URIs
        for (const pair of pairs) {
          const baseLogoURI = logoMap.get(pair.baseToken.address.toLowerCase());
          const quoteLogoURI = logoMap.get(pair.quoteToken.address.toLowerCase());
          if (baseLogoURI) {
            pair.baseToken.logoURI = baseLogoURI;
          }
          if (quoteLogoURI) {
            pair.quoteToken.logoURI = quoteLogoURI;
          }
        }
      }
    } catch (dbError) {
      console.error('Error fetching logo URIs from database:', dbError);
      // Continue without logos
    }

    return NextResponse.json({
      success: true,
      data: {
        pairs,
        totalPairs: numPairs,
        fetchedPairs: pairs.length,
        nativeToken,
        wrappedNativeAddress,
      },
    });
  } catch (error) {
    console.error('Error fetching DEX pairs:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch DEX pairs' },
      { status: 500 }
    );
  }
}
