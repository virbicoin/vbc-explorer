/**
 * DEX Price Utilities
 *
 * Centralized price calculation functions for native, secondary, and other tokens.
 * Uses DEX pool prices instead of external APIs for accuracy.
 */

import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';
import { apiCache, CACHE_TTL } from '@/lib/cache';
import {
  getProvider,
  getCachedPoolInfo,
  getCachedTokenInfo,
  getLPAddresses,
} from './cache-service';

type DexConfigLike = {
  factory?: string;
  router?: string;
  masterChef?: string | { address?: string };
  wrappedNative?: { address?: string; symbol?: string };
  rewardToken?: { address?: string; symbol?: string };
  tokens?: Record<string, { address?: string; symbol?: string } | undefined>;
  lpTokens?: Record<string, { address?: string; token0?: string; token1?: string } | undefined>;
};

const lower = (value: unknown): string => (typeof value === 'string' ? value.toLowerCase() : '');

/**
 * Contract addresses of the DEX, from config.json (`dex`, `currency.priceApi.dex`, `dexInfo`).
 * They used to be hardcoded VirBiCoin addresses, which a change of the configuration did not
 * reach. A pair is found by its address in the price settings or by the token symbols of a
 * `dex.lpTokens` entry. Missing entries are '' (nothing matches them).
 */
export function dexAddresses(source: unknown = loadConfig()) {
  const config = source as {
    dex?: DexConfigLike;
    currency?: { priceApi?: { dex?: { pairAddress?: string; stablecoinAddress?: string } } };
    dexInfo?: { stablePoolAddress?: string };
  };
  const dex = config.dex ?? {};
  const priceDex = config.currency?.priceApi?.dex ?? {};
  const stable = Object.values(dex.tokens ?? {}).find(
    (token) => token?.symbol && STABLECOIN_SYMBOLS.has(token.symbol.toUpperCase())
  );
  const pairOf = (a?: string, b?: string): string => {
    if (!a || !b) return '';
    const want = new Set([a.toUpperCase(), b.toUpperCase()]);
    const pair = Object.values(dex.lpTokens ?? {}).find(
      (lp) =>
        lp?.token0 &&
        lp?.token1 &&
        want.has(lp.token0.toUpperCase()) &&
        want.has(lp.token1.toUpperCase()) &&
        lp.token0.toUpperCase() !== lp.token1.toUpperCase()
    );
    return lower(pair?.address);
  };
  const wrappedNative = lower(dex.wrappedNative?.address);
  const stablecoin = lower(priceDex.stablecoinAddress || stable?.address);
  const secondary = lower(dex.rewardToken?.address);
  const nativeStablePair =
    lower(priceDex.pairAddress || config.dexInfo?.stablePoolAddress) ||
    pairOf(dex.wrappedNative?.symbol, stable?.symbol);
  const nativeSecondaryPair = pairOf(dex.wrappedNative?.symbol, dex.rewardToken?.symbol);
  const masterChef = lower(
    typeof dex.masterChef === 'string' ? dex.masterChef : dex.masterChef?.address
  );
  return {
    WRAPPED_NATIVE: wrappedNative,
    STABLECOIN: stablecoin,
    SECONDARY: secondary,
    NATIVE_STABLECOIN_PAIR: nativeStablePair,
    NATIVE_SECONDARY_PAIR: nativeSecondaryPair,
    MASTERCHEF: masterChef,
    FACTORY: lower(dex.factory),
    ROUTER: lower(dex.router),
    // Native token (zero address)
    NATIVE: '0x0000000000000000000000000000000000000000',
  };
}

// Known stablecoin symbols
export const STABLECOIN_SYMBOLS = new Set(['USDT', 'USDC', 'DAI', 'BUSD']);

export const ADDRESSES = dexAddresses();

// Cache key for DEX prices
const DEX_PRICES_CACHE_KEY = 'dex:prices';

export interface DexPrices {
  native: number;
  secondary: number;
  timestamp: number;
  // Legacy aliases
  vbc: number;
  vbcg: number;
}

/**
 * Get native token price from stablecoin/native pair (DEX internal price)
 * This is the authoritative price for the native token within the DEX.
 */
export async function getNativePriceFromDex(): Promise<number> {
  const cacheKey = 'dex:native_price_dex';
  const cached = apiCache.get<number>(cacheKey);
  if (cached !== undefined && cached > 0) return cached;

  try {
    const poolInfo = await getCachedPoolInfo(ADDRESSES.NATIVE_STABLECOIN_PAIR);
    if (!poolInfo) {
      console.warn('Native/Stablecoin pair not found');
      return 0;
    }

    const { token0, token1, reserve0, reserve1 } = poolInfo;

    // Determine which token is stablecoin and which is wrapped native
    const isToken0Stablecoin = token0.address.toLowerCase() === ADDRESSES.STABLECOIN;
    const stablecoinReserve = isToken0Stablecoin
      ? Number(ethers.formatUnits(reserve0, token0.decimals))
      : Number(ethers.formatUnits(reserve1, token1.decimals));
    const nativeReserve = isToken0Stablecoin
      ? Number(ethers.formatUnits(reserve1, token1.decimals))
      : Number(ethers.formatUnits(reserve0, token0.decimals));

    if (nativeReserve === 0) return 0;

    const nativePrice = stablecoinReserve / nativeReserve;
    apiCache.set(cacheKey, nativePrice, CACHE_TTL.SHORT); // 10s cache
    return nativePrice;
  } catch (error) {
    console.error('Error getting native token price from DEX:', error);
    return 0;
  }
}

/**
 * Get secondary token price from native/secondary pair
 */
export async function getSecondaryPriceFromDex(): Promise<number> {
  const cacheKey = 'dex:secondary_price_dex';
  const cached = apiCache.get<number>(cacheKey);
  if (cached !== undefined && cached > 0) return cached;

  try {
    const nativePrice = await getNativePriceFromDex();
    if (nativePrice === 0) return 0;

    const poolInfo = await getCachedPoolInfo(ADDRESSES.NATIVE_SECONDARY_PAIR);
    if (!poolInfo) {
      console.warn('Native/Secondary pair not found');
      return 0;
    }

    const { token0, token1, reserve0, reserve1 } = poolInfo;

    // Determine which token is wrapped native and which is secondary
    const isToken0Native = token0.address.toLowerCase() === ADDRESSES.WRAPPED_NATIVE;
    const nativeReserve = isToken0Native
      ? Number(ethers.formatUnits(reserve0, token0.decimals))
      : Number(ethers.formatUnits(reserve1, token1.decimals));
    const secondaryReserve = isToken0Native
      ? Number(ethers.formatUnits(reserve1, token1.decimals))
      : Number(ethers.formatUnits(reserve0, token0.decimals));

    if (secondaryReserve === 0) return 0;

    // Secondary price = (native reserve / secondary reserve) * native price
    const secondaryPriceInNative = nativeReserve / secondaryReserve;
    const secondaryPrice = secondaryPriceInNative * nativePrice;

    apiCache.set(cacheKey, secondaryPrice, CACHE_TTL.SHORT);
    return secondaryPrice;
  } catch (error) {
    console.error('Error getting secondary token price from DEX:', error);
    return 0;
  }
}

// Legacy function aliases (for backward compatibility)
export const getVbcPriceFromDex = getNativePriceFromDex;
export const getVbcgPriceFromDex = getSecondaryPriceFromDex;

/**
 * Get all DEX prices (native and secondary tokens)
 */
export async function getDexPrices(): Promise<DexPrices> {
  const cached = apiCache.get<DexPrices>(DEX_PRICES_CACHE_KEY);
  if (cached && Date.now() - cached.timestamp < 10000) {
    return cached;
  }

  const [native, secondary] = await Promise.all([
    getNativePriceFromDex(),
    getSecondaryPriceFromDex(),
  ]);

  const prices: DexPrices = {
    native,
    secondary,
    // Legacy aliases
    vbc: native,
    vbcg: secondary,
    timestamp: Date.now(),
  };

  apiCache.set(DEX_PRICES_CACHE_KEY, prices, CACHE_TTL.SHORT);
  return prices;
}

/**
 * Get token price in USD from DEX
 * @param tokenAddress Token address
 * @returns Price in USD
 */
export async function getTokenPriceUsd(tokenAddress: string): Promise<number> {
  const normalized = tokenAddress.toLowerCase();

  // Stablecoin
  if (normalized === ADDRESSES.STABLECOIN) {
    return 1.0;
  }

  // Wrapped native / Native token
  if (normalized === ADDRESSES.WRAPPED_NATIVE || normalized === ADDRESSES.NATIVE) {
    return await getNativePriceFromDex();
  }

  // Secondary token
  if (normalized === ADDRESSES.SECONDARY) {
    return await getSecondaryPriceFromDex();
  }

  // Other tokens - find from pool
  return await calculateTokenPriceFromPools(normalized);
}

/**
 * Calculate token price from available pools
 */
async function calculateTokenPriceFromPools(tokenAddress: string): Promise<number> {
  const lpAddresses = await getLPAddresses();
  const nativePrice = await getNativePriceFromDex();

  for (const lpAddress of lpAddresses) {
    try {
      const poolInfo = await getCachedPoolInfo(lpAddress);
      if (!poolInfo) continue;

      const { token0, token1, reserve0, reserve1 } = poolInfo;
      const isToken0 = token0.address.toLowerCase() === tokenAddress;
      const isToken1 = token1.address.toLowerCase() === tokenAddress;

      if (!isToken0 && !isToken1) continue;

      const pairedToken = isToken0 ? token1.address.toLowerCase() : token0.address.toLowerCase();
      const reserveNum0 = Number(ethers.formatUnits(reserve0, token0.decimals));
      const reserveNum1 = Number(ethers.formatUnits(reserve1, token1.decimals));

      // Paired with stablecoin
      if (pairedToken === ADDRESSES.STABLECOIN) {
        return isToken0 ? reserveNum1 / reserveNum0 : reserveNum0 / reserveNum1;
      }

      // Paired with wrapped native
      if (pairedToken === ADDRESSES.WRAPPED_NATIVE && nativePrice > 0) {
        const priceInNative = isToken0 ? reserveNum1 / reserveNum0 : reserveNum0 / reserveNum1;
        return priceInNative * nativePrice;
      }
    } catch {
      continue;
    }
  }

  return 0;
}

/**
 * Calculate pool TVL in USD
 * For pools with stablecoins, uses stablecoin reserve * 2 (50/50 pool)
 */
export async function calculatePoolTvlUsd(
  reserve0: string | bigint,
  reserve1: string | bigint,
  token0Address: string,
  token1Address: string,
  decimals0: number,
  decimals1: number
): Promise<number> {
  const normalized0 = token0Address.toLowerCase();
  const normalized1 = token1Address.toLowerCase();

  const reserveNum0 = Number(ethers.formatUnits(reserve0, decimals0));
  const reserveNum1 = Number(ethers.formatUnits(reserve1, decimals1));

  // Check if either token is a stablecoin
  const token0Info = await getCachedTokenInfo(normalized0);
  const token1Info = await getCachedTokenInfo(normalized1);

  const isToken0Stable =
    normalized0 === ADDRESSES.STABLECOIN ||
    STABLECOIN_SYMBOLS.has(token0Info?.symbol?.toUpperCase() || '');
  const isToken1Stable =
    normalized1 === ADDRESSES.STABLECOIN ||
    STABLECOIN_SYMBOLS.has(token1Info?.symbol?.toUpperCase() || '');

  if (isToken0Stable) {
    // Token0 is stablecoin - use its reserve * 2
    return reserveNum0 * 2;
  }

  if (isToken1Stable) {
    // Token1 is stablecoin - use its reserve * 2
    return reserveNum1 * 2;
  }

  // No stablecoin - calculate from DEX prices
  const nativePrice = await getNativePriceFromDex();
  const isToken0Native = normalized0 === ADDRESSES.WRAPPED_NATIVE;
  const isToken1Native = normalized1 === ADDRESSES.WRAPPED_NATIVE;

  if (isToken0Native && nativePrice > 0) {
    return reserveNum0 * nativePrice * 2;
  }

  if (isToken1Native && nativePrice > 0) {
    return reserveNum1 * nativePrice * 2;
  }

  // Fallback: try to get individual token prices
  const [price0, price1] = await Promise.all([
    getTokenPriceUsd(normalized0),
    getTokenPriceUsd(normalized1),
  ]);

  return reserveNum0 * price0 + reserveNum1 * price1;
}

/**
 * Check if address is wrapped native token
 */
export function isWrappedNative(address: string): boolean {
  return address.toLowerCase() === ADDRESSES.WRAPPED_NATIVE;
}

/**
 * Check if address is native token (zero address)
 */
export function isNativeToken(address: string): boolean {
  return address.toLowerCase() === ADDRESSES.NATIVE;
}

/**
 * Check if address is stablecoin
 */
export function isStablecoinAddress(address: string): boolean {
  return address.toLowerCase() === ADDRESSES.STABLECOIN;
}

// Legacy alias
export const isUSDT = isStablecoinAddress;

/**
 * Check if symbol represents a stablecoin
 */
export function isStablecoin(symbol: string): boolean {
  return STABLECOIN_SYMBOLS.has(symbol?.toUpperCase() || '');
}
