/**
 * DEX Price Utilities
 *
 * Centralized price calculation functions for VBC, VBCG, and other tokens.
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

// Known contract addresses
export const ADDRESSES = {
  WVBC: '0x52CB9F0d65D9d4De08CF103153C7A1A97567Bb9b'.toLowerCase(),
  USDT: '0xdf136683B118E95c04A61FEC091c65736d9de059'.toLowerCase(),
  VBCG: '0xac7F60af25C5c4E23d1008C46511e265A8c9B6cF'.toLowerCase(),
  USDT_VBC_PAIR: '0xA67D40496Bd61F9c30efdb040cFCFe6701653d55'.toLowerCase(),
  VBC_VBCG_PAIR: '0x3095069E8725402B43E6Ff127750E1246563e48a'.toLowerCase(),
  MASTERCHEF: '0x12A656c2DeE0EA2685398d52AcF78974fCD67B27'.toLowerCase(),
  FACTORY: '0x663B1b42B79077AaC918515D3f57FED6820Dad63'.toLowerCase(),
  ROUTER: '0xdD1Ae4345252FFEA67fE844296fbd6C973B98c18'.toLowerCase(),
  NATIVE: '0x0000000000000000000000000000000000000000',
};

// Known stablecoin symbols
export const STABLECOIN_SYMBOLS = new Set(['USDT', 'USDC', 'DAI', 'BUSD']);

// Cache key for DEX prices
const DEX_PRICES_CACHE_KEY = 'dex:prices';

export interface DexPrices {
  vbc: number;
  vbcg: number;
  timestamp: number;
}

/**
 * Get VBC price from USDT/VBC pair (DEX internal price)
 * This is the authoritative price for VBC within the DEX.
 */
export async function getVbcPriceFromDex(): Promise<number> {
  const cacheKey = 'dex:vbc_price_dex';
  const cached = apiCache.get<number>(cacheKey);
  if (cached !== undefined && cached > 0) return cached;

  try {
    const poolInfo = await getCachedPoolInfo(ADDRESSES.USDT_VBC_PAIR);
    if (!poolInfo) {
      console.warn('USDT/VBC pair not found');
      return 0;
    }

    const { token0, token1, reserve0, reserve1 } = poolInfo;

    // Determine which token is USDT and which is WVBC
    const isToken0USDT = token0.address.toLowerCase() === ADDRESSES.USDT;
    const usdtReserve = isToken0USDT
      ? Number(ethers.formatUnits(reserve0, token0.decimals))
      : Number(ethers.formatUnits(reserve1, token1.decimals));
    const wvbcReserve = isToken0USDT
      ? Number(ethers.formatUnits(reserve1, token1.decimals))
      : Number(ethers.formatUnits(reserve0, token0.decimals));

    if (wvbcReserve === 0) return 0;

    const vbcPrice = usdtReserve / wvbcReserve;
    apiCache.set(cacheKey, vbcPrice, CACHE_TTL.SHORT); // 10s cache
    return vbcPrice;
  } catch (error) {
    console.error('Error getting VBC price from DEX:', error);
    return 0;
  }
}

/**
 * Get VBCG price from VBC/VBCG pair
 */
export async function getVbcgPriceFromDex(): Promise<number> {
  const cacheKey = 'dex:vbcg_price_dex';
  const cached = apiCache.get<number>(cacheKey);
  if (cached !== undefined && cached > 0) return cached;

  try {
    const vbcPrice = await getVbcPriceFromDex();
    if (vbcPrice === 0) return 0;

    const poolInfo = await getCachedPoolInfo(ADDRESSES.VBC_VBCG_PAIR);
    if (!poolInfo) {
      console.warn('VBC/VBCG pair not found');
      return 0;
    }

    const { token0, token1, reserve0, reserve1 } = poolInfo;

    // Determine which token is WVBC and which is VBCG
    const isToken0WVBC = token0.address.toLowerCase() === ADDRESSES.WVBC;
    const wvbcReserve = isToken0WVBC
      ? Number(ethers.formatUnits(reserve0, token0.decimals))
      : Number(ethers.formatUnits(reserve1, token1.decimals));
    const vbcgReserve = isToken0WVBC
      ? Number(ethers.formatUnits(reserve1, token1.decimals))
      : Number(ethers.formatUnits(reserve0, token0.decimals));

    if (vbcgReserve === 0) return 0;

    // VBCG price = (WVBC reserve / VBCG reserve) * VBC price
    const vbcgPriceInVbc = wvbcReserve / vbcgReserve;
    const vbcgPrice = vbcgPriceInVbc * vbcPrice;

    apiCache.set(cacheKey, vbcgPrice, CACHE_TTL.SHORT);
    return vbcgPrice;
  } catch (error) {
    console.error('Error getting VBCG price from DEX:', error);
    return 0;
  }
}

/**
 * Get all DEX prices (VBC and VBCG)
 */
export async function getDexPrices(): Promise<DexPrices> {
  const cached = apiCache.get<DexPrices>(DEX_PRICES_CACHE_KEY);
  if (cached && Date.now() - cached.timestamp < 10000) {
    return cached;
  }

  const [vbc, vbcg] = await Promise.all([getVbcPriceFromDex(), getVbcgPriceFromDex()]);

  const prices: DexPrices = {
    vbc,
    vbcg,
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

  // USDT (stablecoin)
  if (normalized === ADDRESSES.USDT) {
    return 1.0;
  }

  // WVBC / Native VBC
  if (normalized === ADDRESSES.WVBC || normalized === ADDRESSES.NATIVE) {
    return await getVbcPriceFromDex();
  }

  // VBCG
  if (normalized === ADDRESSES.VBCG) {
    return await getVbcgPriceFromDex();
  }

  // Other tokens - find from pool
  return await calculateTokenPriceFromPools(normalized);
}

/**
 * Calculate token price from available pools
 */
async function calculateTokenPriceFromPools(tokenAddress: string): Promise<number> {
  const lpAddresses = getLPAddresses();
  const vbcPrice = await getVbcPriceFromDex();

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

      // Paired with USDT
      if (pairedToken === ADDRESSES.USDT) {
        return isToken0 ? reserveNum1 / reserveNum0 : reserveNum0 / reserveNum1;
      }

      // Paired with WVBC
      if (pairedToken === ADDRESSES.WVBC && vbcPrice > 0) {
        const priceInVbc = isToken0 ? reserveNum1 / reserveNum0 : reserveNum0 / reserveNum1;
        return priceInVbc * vbcPrice;
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
    normalized0 === ADDRESSES.USDT ||
    STABLECOIN_SYMBOLS.has(token0Info?.symbol?.toUpperCase() || '');
  const isToken1Stable =
    normalized1 === ADDRESSES.USDT ||
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
  const vbcPrice = await getVbcPriceFromDex();
  const isToken0VBC = normalized0 === ADDRESSES.WVBC;
  const isToken1VBC = normalized1 === ADDRESSES.WVBC;

  if (isToken0VBC && vbcPrice > 0) {
    return reserveNum0 * vbcPrice * 2;
  }

  if (isToken1VBC && vbcPrice > 0) {
    return reserveNum1 * vbcPrice * 2;
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
  return address.toLowerCase() === ADDRESSES.WVBC;
}

/**
 * Check if address is native token (zero address)
 */
export function isNativeToken(address: string): boolean {
  return address.toLowerCase() === ADDRESSES.NATIVE;
}

/**
 * Check if address is USDT
 */
export function isUSDT(address: string): boolean {
  return address.toLowerCase() === ADDRESSES.USDT;
}

/**
 * Check if symbol represents a stablecoin
 */
export function isStablecoin(symbol: string): boolean {
  return STABLECOIN_SYMBOLS.has(symbol?.toUpperCase() || '');
}
