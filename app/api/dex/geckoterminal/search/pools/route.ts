// GeckoTerminal Search Pools API - Search for pools by query
// Format: https://docs.geckoterminal.com/reference/get_search-pools
// Optimized with centralized caching
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';
import { apiCache, CACHE_TTL } from '@/lib/cache';
import {
  getCachedNativePrice,
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

// Response cache
const SEARCH_CACHE_PREFIX = 'geckoterminal:search:';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = (searchParams.get('query') || '').trim().toLowerCase().slice(0, 100); // Max 100 chars
    const pageRaw = parseInt(searchParams.get('page') || '1');
    const page = Math.max(1, Math.min(isNaN(pageRaw) ? 1 : pageRaw, 100)); // 1-100 range

    if (!query) {
      return errorResponse(400, 'query parameter is required');
    }

    if (query.length < 2) {
      return errorResponse(400, 'query must be at least 2 characters');
    }

    // Check response cache
    const cacheKey = `${SEARCH_CACHE_PREFIX}${query}:${page}`;
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

    // Get native currency price (cached)
    const nativePriceUsd = await getCachedNativePrice();

    // Get all LP pools from factory (dynamic discovery)
    const lpAddresses = await getLPAddresses();

    const matchingPools = [];

    // Search through pools
    for (const lpAddress of lpAddresses) {
      try {
        // Get cached pool info
        const poolInfo = await getCachedPoolInfo(lpAddress);
        if (!poolInfo) continue;

        const { token0, token1, reserve0, reserve1 } = poolInfo;

        // Check if query matches pool name, token symbols, or addresses
        const poolName = `${token0.symbol}/${token1.symbol}`;
        const searchableText = [
          poolName.toLowerCase(),
          token0.symbol.toLowerCase(),
          token1.symbol.toLowerCase(),
          token0.name.toLowerCase(),
          token1.name.toLowerCase(),
          lpAddress,
          token0.address.toLowerCase(),
          token1.address.toLowerCase(),
        ].join(' ');

        if (!searchableText.includes(query)) {
          continue;
        }
        const wrappedNativeSymbol = config.dex?.wrappedNative?.symbol || 'WETH';
        const nativeSymbol = config.currency?.symbol || 'ETH';

        const isToken0Native = token0.address.toLowerCase() === wrappedNativeAddress;
        const baseSymbol = isToken0Native
          ? token0.symbol === wrappedNativeSymbol
            ? nativeSymbol
            : token0.symbol
          : token1.symbol === wrappedNativeSymbol
            ? nativeSymbol
            : token1.symbol;
        const quoteSymbol = isToken0Native
          ? token1.symbol === wrappedNativeSymbol
            ? nativeSymbol
            : token1.symbol
          : token0.symbol;
        const baseAddress = isToken0Native ? token0.address : token1.address;
        const quoteAddress = isToken0Native ? token1.address : token0.address;

        const reserve0Num = Number(ethers.formatUnits(reserve0, token0.decimals));
        const reserve1Num = Number(ethers.formatUnits(reserve1, token1.decimals));

        let reserveUsd = '0';
        if (isToken0Native && nativePriceUsd > 0) {
          reserveUsd = (reserve0Num * nativePriceUsd * 2).toFixed(2);
        } else if (!isToken0Native && nativePriceUsd > 0) {
          reserveUsd = (reserve1Num * nativePriceUsd * 2).toFixed(2);
        }

        matchingPools.push({
          id: `${networkSlug}_${lpAddress}`,
          type: 'pool',
          attributes: {
            name: `${baseSymbol}/${quoteSymbol}`,
            address: lpAddress,
            base_token_price_usd: nativePriceUsd > 0 ? nativePriceUsd.toString() : null,
            quote_token_price_usd: null,
            reserve_in_usd: reserveUsd,
            pool_created_at: null,
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
        console.error(`Error processing pool ${lpAddress}:`, error);
      }
    }

    // Sort by reserve (liquidity)
    matchingPools.sort(
      (a, b) => parseFloat(b.attributes.reserve_in_usd) - parseFloat(a.attributes.reserve_in_usd)
    );

    // Paginate
    const startIndex = (page - 1) * 10;
    const paginatedPools = matchingPools.slice(startIndex, startIndex + 10);

    const response = { data: paginatedPools };
    apiCache.set(cacheKey, response, CACHE_TTL.MEDIUM); // 60s cache

    return NextResponse.json(response, { headers: API_HEADERS });
  } catch (error) {
    console.error('GeckoTerminal Search Pools API error:', error);
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
