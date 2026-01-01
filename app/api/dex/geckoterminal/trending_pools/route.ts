// GeckoTerminal Trending Pools API - Returns trending pools by volume
// Format: https://docs.geckoterminal.com/reference/get_networks-network-trending_pools
// Optimized with centralized caching
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';
import { connectDB, DexSwap } from '@/models/index';
import { apiCache, CACHE_TTL } from '@/lib/cache';
import {
  getCachedVBCPrice,
  getCachedPoolInfo,
  getWrappedNativeAddress,
  getLPAddresses,
} from '@/lib/dex/cache-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GeckoTerminal API headers
const API_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type',
  'Cache-Control': 'public, max-age=60',
  'X-API-Version': '20230203',
};

// GeckoTerminal error response format
function errorResponse(status: number, title: string) {
  return NextResponse.json(
    { errors: [{ status: String(status), title }] },
    { status, headers: API_HEADERS }
  );
}

// Response cache key
const TRENDING_CACHE_PREFIX = 'geckoterminal:trending:page:';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pageRaw = parseInt(searchParams.get('page') || '1');
    const page = Math.max(1, Math.min(isNaN(pageRaw) ? 1 : pageRaw, 100)); // 1-100 range

    // Check response cache
    const cacheKey = `${TRENDING_CACHE_PREFIX}${page}`;
    const cached = apiCache.get<{ data: unknown[] }>(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { headers: API_HEADERS });
    }

    const config = loadConfig();
    if (!config.dex?.enabled) {
      return errorResponse(404, 'DEX feature is not enabled');
    }

    const wrappedNativeAddress = getWrappedNativeAddress();
    const networkSlug = 'virbicoin';

    await connectDB();

    // Get VBC price (cached)
    const vbcPriceUsd = await getCachedVBCPrice();

    // Get all LP pools from config
    const lpAddresses = getLPAddresses();

    // Get volume data for last 24h and sort by volume
    const h24Ago = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    const volumeData = await DexSwap.aggregate([
      { $match: { pair: { $in: lpAddresses }, timestamp: { $gte: h24Ago } } },
      { $group: { _id: '$pair', totalVolume: { $sum: '$amountUSD' }, txCount: { $sum: 1 } } },
      { $sort: { totalVolume: -1 } },
      { $skip: (page - 1) * 10 },
      { $limit: 10 },
    ]);

    const pools = [];

    // Process with limited concurrency
    for (const vol of volumeData) {
      try {
        const lpAddress = vol._id;

        // Get cached pool info
        const poolInfo = await getCachedPoolInfo(lpAddress);
        if (!poolInfo) continue;

        const { token0, token1, reserve0, reserve1 } = poolInfo;

        const isToken0VBC = token0.address.toLowerCase() === wrappedNativeAddress;
        const baseSymbol = isToken0VBC
          ? token0.symbol === 'WVBC'
            ? 'VBC'
            : token0.symbol
          : token1.symbol === 'WVBC'
            ? 'VBC'
            : token1.symbol;
        const quoteSymbol = isToken0VBC
          ? token1.symbol === 'WVBC'
            ? 'VBC'
            : token1.symbol
          : token0.symbol;
        const baseAddress = isToken0VBC ? token0.address : token1.address;
        const quoteAddress = isToken0VBC ? token1.address : token0.address;

        const reserve0Num = Number(ethers.formatUnits(reserve0, token0.decimals));
        const reserve1Num = Number(ethers.formatUnits(reserve1, token1.decimals));

        let reserveUsd = '0';
        if (isToken0VBC && vbcPriceUsd > 0) {
          reserveUsd = (reserve0Num * vbcPriceUsd * 2).toFixed(2);
        } else if (!isToken0VBC && vbcPriceUsd > 0) {
          reserveUsd = (reserve1Num * vbcPriceUsd * 2).toFixed(2);
        }

        pools.push({
          id: `${networkSlug}_${lpAddress}`,
          type: 'pool',
          attributes: {
            name: `${baseSymbol}/${quoteSymbol}`,
            address: lpAddress,
            base_token_price_usd: vbcPriceUsd > 0 ? vbcPriceUsd.toString() : null,
            quote_token_price_usd: null,
            reserve_in_usd: reserveUsd,
            pool_created_at: null,
            volume_usd: {
              h24: vol.totalVolume.toFixed(2),
            },
            transactions: {
              h24: { buys: 0, sells: 0, buyers: 0, sellers: 0 },
            },
          },
          relationships: {
            base_token: {
              data: { id: `${networkSlug}_${baseAddress.toLowerCase()}`, type: 'token' },
            },
            quote_token: {
              data: { id: `${networkSlug}_${quoteAddress.toLowerCase()}`, type: 'token' },
            },
            dex: {
              data: { id: `${networkSlug}_dex`, type: 'dex' },
            },
          },
        });
      } catch (error) {
        console.error(`Error processing pool ${vol._id}:`, error);
      }
    }

    const response = { data: pools };
    apiCache.set(cacheKey, response, CACHE_TTL.MEDIUM); // 60s cache

    return NextResponse.json(response, { headers: API_HEADERS });
  } catch (error) {
    console.error('GeckoTerminal Trending Pools API error:', error);
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
