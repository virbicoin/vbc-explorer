// GeckoTerminal Pools API - Returns pool data in GeckoTerminal compatible format
// Optimized version with centralized caching to reduce RPC calls
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { apiCache, CACHE_TTL } from '@/lib/cache';
import {
  getCachedPoolInfo,
  getCachedPoolStats,
  getLPAddresses,
  getWrappedNativeAddress,
  getUSDTAddress,
} from '@/lib/dex/cache-service';
import { getVbcPriceFromDex, getVbcgPriceFromDex, ADDRESSES } from '@/lib/dex/priceUtils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GeckoTerminal API headers
const API_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type',
  'Cache-Control': 'public, max-age=30',
  'X-API-Version': '20230203',
};

// GeckoTerminal error response format
function errorResponse(status: number, title: string) {
  return NextResponse.json(
    { errors: [{ status: String(status), title }] },
    { status, headers: API_HEADERS }
  );
}

interface PoolData {
  id: string;
  type: string;
  attributes: {
    name: string;
    pool_name: string | null;
    address: string;
    base_token_price_usd: string | null;
    quote_token_price_usd: string | null;
    base_token_price_native_currency: string;
    quote_token_price_native_currency: string;
    base_token_price_quote_token: string;
    quote_token_price_base_token: string;
    pool_created_at: string | null;
    reserve_in_usd: string;
    fdv_usd: string | null;
    market_cap_usd: string | null;
    locked_liquidity_percentage: string | null;
    pool_fee_percentage: string;
    price_change_percentage: {
      m5: string;
      m15: string;
      m30: string;
      h1: string;
      h6: string;
      h24: string;
    };
    transactions: {
      m5: { buys: number; sells: number; buyers: number; sellers: number };
      m15: { buys: number; sells: number; buyers: number; sellers: number };
      m30: { buys: number; sells: number; buyers: number; sellers: number };
      h1: { buys: number; sells: number; buyers: number; sellers: number };
      h6: { buys: number; sells: number; buyers: number; sellers: number };
      h24: { buys: number; sells: number; buyers: number; sellers: number };
    };
    volume_usd: {
      m5: string;
      m15: string;
      m30: string;
      h1: string;
      h6: string;
      h24: string;
    };
  };
  relationships: {
    base_token: { data: { id: string; type: string } };
    quote_token: { data: { id: string; type: string } };
    dex: { data: { id: string; type: string } };
  };
}

// Response-level cache (60 seconds for full pools response)
const POOLS_CACHE_KEY = 'geckoterminal:pools:response';
const RESPONSE_CACHE_TTL = 60000; // 60 seconds

export async function GET() {
  try {
    // Check response-level cache first
    const cached = apiCache.get<{ data: PoolData[]; timestamp: number }>(POOLS_CACHE_KEY);
    if (cached && Date.now() - cached.timestamp < RESPONSE_CACHE_TTL) {
      return NextResponse.json({ data: cached.data }, { headers: API_HEADERS });
    }

    const networkSlug = 'virbicoin';
    const wrappedNativeAddress = getWrappedNativeAddress();
    const usdtAddress = getUSDTAddress();
    const lpAddresses = getLPAddresses();

    // Get VBC and VBCG prices from DEX (not external API)
    const [vbcPriceUsd, vbcgPriceUsd] = await Promise.all([
      getVbcPriceFromDex(),
      getVbcgPriceFromDex(),
    ]);

    const pools: PoolData[] = [];

    // Process pools with limited concurrency
    const BATCH_SIZE = 2;
    for (let i = 0; i < lpAddresses.length; i += BATCH_SIZE) {
      const batch = lpAddresses.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (lpAddress) => {
          try {
            // Get cached pool info
            const poolInfo = await getCachedPoolInfo(lpAddress);
            if (!poolInfo) return null;

            const { token0, token1, reserve0, reserve1 } = poolInfo;

            const reserveNum0 = Number(ethers.formatUnits(reserve0, token0.decimals));
            const reserveNum1 = Number(ethers.formatUnits(reserve1, token1.decimals));

            if (reserveNum0 === 0 || reserveNum1 === 0) return null;

            // Display symbol (WVBC -> VBC)
            const displaySymbol0 = token0.symbol === 'WVBC' ? 'VBC' : token0.symbol;
            const displaySymbol1 = token1.symbol === 'WVBC' ? 'VBC' : token1.symbol;

            // Determine if VBC (WVBC) should be the base token
            const isToken0VBC =
              token0.address.toLowerCase() === wrappedNativeAddress ||
              token0.symbol === 'WVBC' ||
              token0.symbol === 'VBC';
            const isToken1VBC =
              token1.address.toLowerCase() === wrappedNativeAddress ||
              token1.symbol === 'WVBC' ||
              token1.symbol === 'VBC';

            // Set up base/quote based on VBC position
            let baseSymbol: string;
            let quoteSymbol: string;
            let baseAddress: string;
            let quoteAddress: string;
            let baseReserve: number;
            let quoteReserve: number;

            if (isToken0VBC && !isToken1VBC) {
              baseSymbol = displaySymbol0;
              quoteSymbol = displaySymbol1;
              baseAddress = token0.address;
              quoteAddress = token1.address;
              baseReserve = reserveNum0;
              quoteReserve = reserveNum1;
            } else if (isToken1VBC && !isToken0VBC) {
              baseSymbol = displaySymbol1;
              quoteSymbol = displaySymbol0;
              baseAddress = token1.address;
              quoteAddress = token0.address;
              baseReserve = reserveNum1;
              quoteReserve = reserveNum0;
            } else {
              baseSymbol = displaySymbol0;
              quoteSymbol = displaySymbol1;
              baseAddress = token0.address;
              quoteAddress = token1.address;
              baseReserve = reserveNum0;
              quoteReserve = reserveNum1;
            }

            // Price calculations
            const price = quoteReserve / baseReserve;
            const priceInverse = baseReserve / quoteReserve;

            // Calculate USD values
            // For pools with stablecoins (USDT/USDC), use the stablecoin reserve to value the other token
            // This reflects the actual DEX price, not external CEX price
            let baseReserveUsd = 0;
            let quoteReserveUsd = 0;
            let baseTokenPriceUsd: string | null = null;
            let quoteTokenPriceUsd: string | null = null;

            const isBaseVBC =
              baseAddress.toLowerCase() === wrappedNativeAddress || baseSymbol === 'VBC';
            const isQuoteUSDT = quoteAddress.toLowerCase() === usdtAddress;
            const isBaseUSDT = baseAddress.toLowerCase() === usdtAddress;
            const isQuoteVBCG = quoteAddress.toLowerCase() === ADDRESSES.VBCG;
            const isBaseVBCG = baseAddress.toLowerCase() === ADDRESSES.VBCG;

            if (isBaseVBC && isQuoteUSDT) {
              // VBC/USDT pair - use USDT reserve to value VBC (50/50 pool)
              baseReserveUsd = quoteReserve; // VBC value = USDT value
              quoteReserveUsd = quoteReserve; // USDT = 1 USD
              const dexVbcPrice = quoteReserve / baseReserve; // DEX price of VBC in USD
              baseTokenPriceUsd = dexVbcPrice.toString();
              quoteTokenPriceUsd = '1';
            } else if (isBaseVBC && isQuoteVBCG) {
              // VBC/VBCG pair - use DEX VBC price to calculate both values
              baseReserveUsd = baseReserve * vbcPriceUsd;
              quoteReserveUsd = quoteReserve * vbcgPriceUsd;
              baseTokenPriceUsd = vbcPriceUsd.toString();
              quoteTokenPriceUsd = vbcgPriceUsd.toString();
            } else if (isBaseUSDT) {
              // USDT/X pair - use USDT reserve to value X (50/50 pool)
              baseReserveUsd = baseReserve; // USDT = 1 USD
              quoteReserveUsd = baseReserve; // X value = USDT value
              const quoteTokenPrice = baseReserve / quoteReserve; // DEX price
              baseTokenPriceUsd = '1';
              quoteTokenPriceUsd = quoteTokenPrice.toString();
            } else if (isBaseVBCG) {
              // VBCG/X pair - use DEX VBCG price
              baseReserveUsd = baseReserve * vbcgPriceUsd;
              const quoteTokenPrice = (baseReserve / quoteReserve) * vbcgPriceUsd;
              quoteReserveUsd = quoteReserve * quoteTokenPrice;
              baseTokenPriceUsd = vbcgPriceUsd.toString();
              quoteTokenPriceUsd = quoteTokenPrice.toString();
            } else if (isBaseVBC) {
              // VBC/X pair (no stablecoin, not VBCG) - use DEX VBC price
              baseReserveUsd = baseReserve * vbcPriceUsd;
              const quoteTokenPrice = (baseReserve / quoteReserve) * vbcPriceUsd;
              quoteReserveUsd = quoteReserve * quoteTokenPrice;
              baseTokenPriceUsd = vbcPriceUsd.toString();
              quoteTokenPriceUsd = quoteTokenPrice.toString();
            } else {
              // Fallback - use DEX VBC price
              baseReserveUsd = baseReserve * vbcPriceUsd;
              quoteReserveUsd = quoteReserve * vbcPriceUsd;
              baseTokenPriceUsd = vbcPriceUsd.toString();
              quoteTokenPriceUsd = vbcPriceUsd.toString();
            }

            const totalLiquidityUsd = baseReserveUsd + quoteReserveUsd;

            // Get pool stats (cached)
            const poolStats = await getCachedPoolStats(lpAddress);

            const poolData: PoolData = {
              id: `${networkSlug}_${lpAddress}`,
              type: 'pool',
              attributes: {
                name: `${baseSymbol}/${quoteSymbol}`,
                pool_name: null,
                address: lpAddress,
                base_token_price_usd: baseTokenPriceUsd,
                quote_token_price_usd: quoteTokenPriceUsd,
                base_token_price_native_currency: price.toString(),
                quote_token_price_native_currency: priceInverse.toString(),
                base_token_price_quote_token: price.toString(),
                quote_token_price_base_token: priceInverse.toString(),
                pool_created_at: null,
                reserve_in_usd: totalLiquidityUsd.toFixed(2),
                fdv_usd: null,
                market_cap_usd: null,
                locked_liquidity_percentage: null,
                pool_fee_percentage: '0.3',
                price_change_percentage: {
                  m5: '0',
                  m15: '0',
                  m30: '0',
                  h1: '0',
                  h6: '0',
                  h24: '0',
                },
                transactions: {
                  m5: {
                    buys: poolStats.buys.m5,
                    sells: poolStats.sells.m5,
                    buyers: poolStats.buyers.m5,
                    sellers: poolStats.sellers.m5,
                  },
                  m15: {
                    buys: poolStats.buys.m15,
                    sells: poolStats.sells.m15,
                    buyers: poolStats.buyers.m15,
                    sellers: poolStats.sellers.m15,
                  },
                  m30: {
                    buys: poolStats.buys.m30,
                    sells: poolStats.sells.m30,
                    buyers: poolStats.buyers.m30,
                    sellers: poolStats.sellers.m30,
                  },
                  h1: {
                    buys: poolStats.buys.h1,
                    sells: poolStats.sells.h1,
                    buyers: poolStats.buyers.h1,
                    sellers: poolStats.sellers.h1,
                  },
                  h6: {
                    buys: poolStats.buys.h6,
                    sells: poolStats.sells.h6,
                    buyers: poolStats.buyers.h6,
                    sellers: poolStats.sellers.h6,
                  },
                  h24: {
                    buys: poolStats.buys.h24,
                    sells: poolStats.sells.h24,
                    buyers: poolStats.buyers.h24,
                    sellers: poolStats.sellers.h24,
                  },
                },
                volume_usd: {
                  m5: poolStats.volume.m5.toFixed(2),
                  m15: poolStats.volume.m15.toFixed(2),
                  m30: poolStats.volume.m30.toFixed(2),
                  h1: poolStats.volume.h1.toFixed(2),
                  h6: poolStats.volume.h6.toFixed(2),
                  h24: poolStats.volume.h24.toFixed(2),
                },
              },
              relationships: {
                base_token: {
                  data: {
                    id: `${networkSlug}_${baseAddress.toLowerCase()}`,
                    type: 'token',
                  },
                },
                quote_token: {
                  data: {
                    id: `${networkSlug}_${quoteAddress.toLowerCase()}`,
                    type: 'token',
                  },
                },
                dex: {
                  data: {
                    id: 'virbicoin_dex',
                    type: 'dex',
                  },
                },
              },
            };

            return poolData;
          } catch (error) {
            console.error(`Error processing pair ${lpAddress}:`, error);
            return null;
          }
        })
      );

      pools.push(...batchResults.filter((p): p is PoolData => p !== null));
    }

    // Sort by liquidity
    pools.sort(
      (a, b) => parseFloat(b.attributes.reserve_in_usd) - parseFloat(a.attributes.reserve_in_usd)
    );

    // Update response cache
    apiCache.set(POOLS_CACHE_KEY, { data: pools, timestamp: Date.now() }, CACHE_TTL.MEDIUM);

    return NextResponse.json({ data: pools }, { headers: API_HEADERS });
  } catch (error) {
    console.error('GeckoTerminal Pools API error:', error);
    return errorResponse(500, 'Internal server error');
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept, Content-Type',
    },
  });
}
