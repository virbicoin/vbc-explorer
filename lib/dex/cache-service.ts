/**
 * DEX Data Cache Service
 *
 * Centralized caching for DEX-related data to reduce RPC calls and database queries.
 * This significantly reduces load on t4g.medium instances.
 */

import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';
import { apiCache, CACHE_TTL } from '@/lib/cache';
import { connectDB, DexSwap } from '@/models/index';
import { getNativePrice } from '@/lib/price-service';
import type { PriceData } from '@/lib/price-service';

const PAIR_ABI = [
  'function getReserves() view returns (uint256 reserve0, uint256 reserve1)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function totalSupply() view returns (uint256)',
];

const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function decimals() external view returns (uint8)',
];

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

export interface PoolInfo {
  address: string;
  token0: TokenInfo;
  token1: TokenInfo;
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
}

export interface PoolStats {
  volume: { m5: number; m15: number; m30: number; h1: number; h6: number; h24: number };
  txCount: { m5: number; m15: number; m30: number; h1: number; h6: number; h24: number };
  buys: { m5: number; m15: number; m30: number; h1: number; h6: number; h24: number };
  sells: { m5: number; m15: number; m30: number; h1: number; h6: number; h24: number };
  buyers: { m5: number; m15: number; m30: number; h1: number; h6: number; h24: number };
  sellers: { m5: number; m15: number; m30: number; h1: number; h6: number; h24: number };
}

// Time intervals in seconds
const TIME_INTERVALS = {
  m5: 5 * 60,
  m15: 15 * 60,
  m30: 30 * 60,
  h1: 60 * 60,
  h6: 6 * 60 * 60,
  h24: 24 * 60 * 60,
};

let providerInstance: ethers.JsonRpcProvider | null = null;

/**
 * Get cached provider instance
 */
export function getProvider(): ethers.JsonRpcProvider {
  if (!providerInstance) {
    const config = loadConfig();
    providerInstance = new ethers.JsonRpcProvider(
      config.network?.rpcUrl || config.web3Provider?.url
    );
  }
  return providerInstance;
}

/**
 * Get VBC price with caching
 */
export async function getCachedVBCPrice(): Promise<number> {
  const cacheKey = 'dex:vbc_price';
  const cached = apiCache.get<number>(cacheKey);
  if (cached !== undefined) return cached;

  const priceData = await getNativePrice();
  const price = priceData?.priceUSD || 0;
  apiCache.set(cacheKey, price, CACHE_TTL.SHORT); // 10s cache
  return price;
}

/**
 * Get token info with caching
 */
export async function getCachedTokenInfo(tokenAddress: string): Promise<TokenInfo | null> {
  const cacheKey = `dex:token:${tokenAddress.toLowerCase()}`;
  const cached = apiCache.get<TokenInfo>(cacheKey);
  if (cached) return cached;

  try {
    const provider = getProvider();
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [symbol, name, decimals] = await Promise.all([
      contract.symbol().catch(() => 'UNKNOWN'),
      contract.name().catch(() => 'Unknown Token'),
      contract.decimals().catch(() => 18),
    ]);

    const info: TokenInfo = {
      address: tokenAddress.toLowerCase(),
      symbol,
      name,
      decimals: Number(decimals),
    };

    apiCache.set(cacheKey, info, CACHE_TTL.VERY_LONG); // 30 min cache
    return info;
  } catch {
    return null;
  }
}

/**
 * Get pool info with caching
 */
export async function getCachedPoolInfo(poolAddress: string): Promise<PoolInfo | null> {
  const cacheKey = `dex:pool:${poolAddress.toLowerCase()}`;
  const cached = apiCache.get<PoolInfo>(cacheKey);
  if (cached) return cached;

  try {
    const provider = getProvider();
    const pairContract = new ethers.Contract(poolAddress, PAIR_ABI, provider);

    const [reserves, token0Addr, token1Addr, totalSupply] = await Promise.all([
      pairContract.getReserves(),
      pairContract.token0(),
      pairContract.token1(),
      pairContract.totalSupply(),
    ]);

    const [token0Info, token1Info] = await Promise.all([
      getCachedTokenInfo(token0Addr),
      getCachedTokenInfo(token1Addr),
    ]);

    if (!token0Info || !token1Info) return null;

    const info: PoolInfo = {
      address: poolAddress.toLowerCase(),
      token0: token0Info,
      token1: token1Info,
      reserve0: reserves[0],
      reserve1: reserves[1],
      totalSupply,
    };

    apiCache.set(cacheKey, info, CACHE_TTL.SHORT); // 10s for reserves
    return info;
  } catch {
    return null;
  }
}

/**
 * Get pool statistics with caching
 */
export async function getCachedPoolStats(poolAddress: string): Promise<PoolStats> {
  const cacheKey = `dex:poolstats:${poolAddress.toLowerCase()}`;
  const cached = apiCache.get<PoolStats>(cacheKey);
  if (cached) return cached;

  const stats: PoolStats = {
    volume: { m5: 0, m15: 0, m30: 0, h1: 0, h6: 0, h24: 0 },
    txCount: { m5: 0, m15: 0, m30: 0, h1: 0, h6: 0, h24: 0 },
    buys: { m5: 0, m15: 0, m30: 0, h1: 0, h6: 0, h24: 0 },
    sells: { m5: 0, m15: 0, m30: 0, h1: 0, h6: 0, h24: 0 },
    buyers: { m5: 0, m15: 0, m30: 0, h1: 0, h6: 0, h24: 0 },
    sellers: { m5: 0, m15: 0, m30: 0, h1: 0, h6: 0, h24: 0 },
  };

  try {
    await connectDB();
    const now = Math.floor(Date.now() / 1000);
    const h24Ago = now - TIME_INTERVALS.h24;

    const swaps = await DexSwap.find({
      pair: poolAddress.toLowerCase(),
      timestamp: { $gte: h24Ago },
    })
      .select('timestamp amountUSD amount0In sender')
      .lean();

    const buyersSet: Record<string, Set<string>> = {
      m5: new Set(),
      m15: new Set(),
      m30: new Set(),
      h1: new Set(),
      h6: new Set(),
      h24: new Set(),
    };
    const sellersSet: Record<string, Set<string>> = {
      m5: new Set(),
      m15: new Set(),
      m30: new Set(),
      h1: new Set(),
      h6: new Set(),
      h24: new Set(),
    };

    for (const swap of swaps) {
      const age = now - swap.timestamp;
      const isBuy = BigInt(swap.amount0In || '0') > 0n;
      const trader = (swap.sender || '').toLowerCase();

      for (const [interval, seconds] of Object.entries(TIME_INTERVALS)) {
        const key = interval as keyof typeof TIME_INTERVALS;
        if (age <= seconds) {
          stats.volume[key] += swap.amountUSD || 0;
          stats.txCount[key]++;
          if (isBuy) {
            stats.buys[key]++;
            if (trader) buyersSet[key].add(trader);
          } else {
            stats.sells[key]++;
            if (trader) sellersSet[key].add(trader);
          }
        }
      }
    }

    // Convert sets to counts
    for (const key of Object.keys(TIME_INTERVALS) as Array<keyof typeof TIME_INTERVALS>) {
      stats.buyers[key] = buyersSet[key].size;
      stats.sellers[key] = sellersSet[key].size;
    }
  } catch (error) {
    console.error('Error fetching pool stats:', error);
  }

  apiCache.set(cacheKey, stats, CACHE_TTL.SHORT); // 10s cache
  return stats;
}

/**
 * Get all LP addresses from config
 */
export function getLPAddresses(): string[] {
  const cacheKey = 'dex:lp_addresses';
  const cached = apiCache.get<string[]>(cacheKey);
  if (cached) return cached;

  const config = loadConfig();
  const lpTokens = (config.dex?.lpTokens || {}) as Record<string, { address: string }>;
  const farmPools = (config.dex?.farmPools || []) as Array<{ lpToken: string }>;

  const addresses = new Set<string>();
  Object.values(lpTokens).forEach((lp) => addresses.add(lp.address.toLowerCase()));
  farmPools.forEach((pool) => addresses.add(pool.lpToken.toLowerCase()));

  const result = Array.from(addresses);
  apiCache.set(cacheKey, result, CACHE_TTL.VERY_LONG);
  return result;
}

/**
 * Get wrapped native address
 */
export function getWrappedNativeAddress(): string {
  const config = loadConfig();
  return config.dex?.wrappedNative?.address?.toLowerCase() || '';
}

/**
 * Get USDT address
 */
export function getUSDTAddress(): string {
  const config = loadConfig();
  return config.dex?.tokens?.usdt?.address?.toLowerCase() || '';
}

/**
 * Batch get pool info for multiple pools
 */
export async function batchGetPoolInfo(addresses: string[]): Promise<Map<string, PoolInfo>> {
  const result = new Map<string, PoolInfo>();

  // Get from cache first
  const uncached: string[] = [];
  for (const addr of addresses) {
    const cached = apiCache.get<PoolInfo>(`dex:pool:${addr.toLowerCase()}`);
    if (cached) {
      result.set(addr.toLowerCase(), cached);
    } else {
      uncached.push(addr);
    }
  }

  // Fetch uncached in parallel (limit concurrency to avoid overload)
  const BATCH_SIZE = 3;
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    const infos = await Promise.all(batch.map((addr) => getCachedPoolInfo(addr)));
    for (let j = 0; j < batch.length; j++) {
      if (infos[j]) {
        result.set(batch[j].toLowerCase(), infos[j]!);
      }
    }
  }

  return result;
}
