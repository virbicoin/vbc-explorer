// GeckoTerminal Single Pool API - Returns detailed data for a specific pool
// Format: https://docs.geckoterminal.com/reference/get_networks-network-pools-address
// Optimized with centralized caching
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { loadConfig } from '@/lib/config';
import { connectDB, Contract } from '@/models/index';
import { apiCache, CACHE_TTL } from '@/lib/cache';
import {
  getCachedNativePrice,
  getCachedPoolInfo,
  getCachedPoolStats,
  getCachedTokenInfo,
  getWrappedNativeAddress,
  getUSDTAddress,
  getProvider,
} from '@/lib/dex/cache-service';

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

const ERC20_ABI = ['function totalSupply() external view returns (uint256)'];

// Response cache
const POOL_CACHE_PREFIX = 'geckoterminal:pool:';

export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address: poolAddress } = await params;

    const config = loadConfig();
    if (!config.dex?.enabled) {
      return errorResponse(404, 'DEX feature is not enabled');
    }

    // Validate address
    if (!ethers.isAddress(poolAddress)) {
      return errorResponse(400, 'Invalid pool address');
    }

    const normalizedAddress = poolAddress.toLowerCase();

    // Check response cache
    const cacheKey = `${POOL_CACHE_PREFIX}${normalizedAddress}`;
    const cached = apiCache.get<object>(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { headers: API_HEADERS });
    }

    const wrappedNativeAddress = getWrappedNativeAddress();
    const usdtAddress = getUSDTAddress();
    const networkSlug = config.network?.slug || 'ethereum';

    // Connect to database
    await connectDB();

    // Get cached pool info
    const poolInfo = await getCachedPoolInfo(normalizedAddress);
    if (!poolInfo) {
      return errorResponse(404, 'Pool not found');
    }

    const { token0, token1, reserve0, reserve1, totalSupply } = poolInfo;

    const reserveNum0 = Number(ethers.formatUnits(reserve0, token0.decimals));
    const reserveNum1 = Number(ethers.formatUnits(reserve1, token1.decimals));

    if (reserveNum0 === 0 || reserveNum1 === 0) {
      return errorResponse(404, 'Pool has no liquidity');
    }

    // Display symbol (wrapped native -> native)
    const wrappedNativeSymbol = config.dex?.wrappedNative?.symbol || 'WETH';
    const nativeSymbol = config.currency?.symbol || 'ETH';
    const displaySymbol0 = token0.symbol === wrappedNativeSymbol ? nativeSymbol : token0.symbol;
    const displaySymbol1 = token1.symbol === wrappedNativeSymbol ? nativeSymbol : token1.symbol;

    // Determine base/quote tokens (native is always base)
    const isToken0Native =
      token0.address.toLowerCase() === wrappedNativeAddress ||
      token0.symbol === wrappedNativeSymbol;
    const isToken1Native =
      token1.address.toLowerCase() === wrappedNativeAddress ||
      token1.symbol === wrappedNativeSymbol;

    let baseSymbol: string, quoteSymbol: string;
    let baseName: string, quoteName: string;
    let baseAddress: string, quoteAddress: string;
    let baseDecimals: number, quoteDecimals: number;
    let baseReserve: number, quoteReserve: number;

    if (isToken0Native && !isToken1Native) {
      baseSymbol = displaySymbol0;
      quoteSymbol = displaySymbol1;
      baseName = token0.name;
      quoteName = token1.name;
      baseAddress = token0.address;
      quoteAddress = token1.address;
      baseDecimals = token0.decimals;
      quoteDecimals = token1.decimals;
      baseReserve = reserveNum0;
      quoteReserve = reserveNum1;
    } else if (isToken1Native && !isToken0Native) {
      baseSymbol = displaySymbol1;
      quoteSymbol = displaySymbol0;
      baseName = token1.name;
      quoteName = token0.name;
      baseAddress = token1.address;
      quoteAddress = token0.address;
      baseDecimals = token1.decimals;
      quoteDecimals = token0.decimals;
      baseReserve = reserveNum1;
      quoteReserve = reserveNum0;
    } else {
      baseSymbol = displaySymbol0;
      quoteSymbol = displaySymbol1;
      baseName = token0.name;
      quoteName = token1.name;
      baseAddress = token0.address;
      quoteAddress = token1.address;
      baseDecimals = token0.decimals;
      quoteDecimals = token1.decimals;
      baseReserve = reserveNum0;
      quoteReserve = reserveNum1;
    }

    // Price calculations
    const price = quoteReserve / baseReserve;
    const priceInverse = baseReserve / quoteReserve;

    // Get native price in USD (cached) - used as fallback for non-USDT pairs
    const nativePriceUsd = await getCachedNativePrice();

    // Calculate USD values
    // For pools with stablecoins (USDT/USDC), use the stablecoin reserve to value the other token
    // This reflects the actual DEX price, not external CEX price
    let baseTokenPriceUsd: string | null = null;
    let quoteTokenPriceUsd: string | null = null;
    let baseReserveUsd = 0;
    let quoteReserveUsd = 0;

    const isBaseNative =
      baseAddress.toLowerCase() === wrappedNativeAddress || baseSymbol === nativeSymbol;
    const isQuoteUSDT = quoteAddress.toLowerCase() === usdtAddress;
    const isBaseUSDT = baseAddress.toLowerCase() === usdtAddress;

    if (isBaseNative && isQuoteUSDT) {
      // Native/USDT pair - use USDT reserve to value native (50/50 pool)
      const dexNativePrice = quoteReserve / baseReserve; // DEX price of native in USD
      baseTokenPriceUsd = dexNativePrice.toString();
      quoteTokenPriceUsd = '1';
      baseReserveUsd = quoteReserve; // Native value = USDT value (50/50 pool)
      quoteReserveUsd = quoteReserve; // USDT = 1 USD
    } else if (isBaseUSDT) {
      // USDT/X pair - use USDT reserve to value X (50/50 pool)
      const quoteTokenPrice = baseReserve / quoteReserve; // DEX price
      baseTokenPriceUsd = '1';
      quoteTokenPriceUsd = quoteTokenPrice.toString();
      baseReserveUsd = baseReserve; // USDT = 1 USD
      quoteReserveUsd = baseReserve; // X value = USDT value (50/50 pool)
    } else if (isBaseNative) {
      // Native/X pair (no stablecoin) - use external price
      baseTokenPriceUsd = nativePriceUsd.toString();
      const quoteTokenPrice = (baseReserve / quoteReserve) * nativePriceUsd;
      quoteTokenPriceUsd = quoteTokenPrice.toString();
      baseReserveUsd = baseReserve * nativePriceUsd;
      quoteReserveUsd = quoteReserve * quoteTokenPrice;
    } else {
      // Fallback - use external price
      baseReserveUsd = baseReserve * nativePriceUsd;
      quoteReserveUsd = quoteReserve * nativePriceUsd;
      baseTokenPriceUsd = nativePriceUsd.toString();
      quoteTokenPriceUsd = nativePriceUsd.toString();
    }

    const totalLiquidityUsd = baseReserveUsd + quoteReserveUsd;

    // Get token total supplies (for FDV calculation)
    const provider = getProvider();
    let baseSupply = BigInt(0);
    let quoteSupply = BigInt(0);

    try {
      const baseContract = new ethers.Contract(baseAddress, ERC20_ABI, provider);
      const quoteContract = new ethers.Contract(quoteAddress, ERC20_ABI, provider);
      [baseSupply, quoteSupply] = await Promise.all([
        baseContract.totalSupply().catch(() => BigInt(0)),
        quoteContract.totalSupply().catch(() => BigInt(0)),
      ]);
    } catch {
      // Ignore errors
    }

    // Calculate FDV for base token
    let fdvUsd: string | null = null;
    if (baseTokenPriceUsd && baseSupply > 0n) {
      const totalSupplyNum = Number(ethers.formatUnits(baseSupply, baseDecimals));
      fdvUsd = (totalSupplyNum * parseFloat(baseTokenPriceUsd)).toFixed(2);
    }

    // Get pool statistics (cached)
    const poolStats = await getCachedPoolStats(normalizedAddress);

    // Get token info from Contract collection
    const [baseContractInfo, quoteContractInfo] = await Promise.all([
      Contract.findOne({ address: baseAddress.toLowerCase() }).lean(),
      Contract.findOne({ address: quoteAddress.toLowerCase() }).lean(),
    ]);

    // Build included tokens array
    const wrappedNativeName = config.dex?.wrappedNative?.name || 'Wrapped ETH';
    const nativeName = config.currency?.name || 'Ether';
    const includedTokens = [
      {
        id: `${networkSlug}_${baseAddress.toLowerCase()}`,
        type: 'token',
        attributes: {
          address: baseAddress.toLowerCase(),
          name: baseName === wrappedNativeName ? nativeName : baseName,
          symbol: baseSymbol,
          decimals: baseDecimals,
          image_url: baseContractInfo?.image_url || null,
          coingecko_coin_id: null,
          total_supply: baseSupply.toString(),
          price_usd: baseTokenPriceUsd,
          fdv_usd: fdvUsd,
          total_reserve_in_usd: baseReserveUsd.toFixed(2),
          volume_usd: {
            h24: poolStats.volume.h24.toFixed(2),
          },
        },
      },
      {
        id: `${networkSlug}_${quoteAddress.toLowerCase()}`,
        type: 'token',
        attributes: {
          address: quoteAddress.toLowerCase(),
          name: quoteName,
          symbol: quoteSymbol,
          decimals: quoteDecimals,
          image_url: quoteContractInfo?.image_url || null,
          coingecko_coin_id: quoteSymbol === 'USDT' ? 'tether' : null,
          total_supply: quoteSupply.toString(),
          price_usd: quoteTokenPriceUsd,
          fdv_usd: null,
          total_reserve_in_usd: quoteReserveUsd.toFixed(2),
          volume_usd: {
            h24: poolStats.volume.h24.toFixed(2),
          },
        },
      },
    ];

    // Build DEX info
    const dexName =
      config.dex?.name || `${config.network?.name || config.currency?.name || 'Blockchain'} DEX`;
    const dexInfo = {
      id: `${networkSlug}_dex`,
      type: 'dex',
      attributes: {
        name: dexName,
        identifier: dexName,
        url: null,
      },
    };

    const response = {
      data: {
        id: `${networkSlug}_${normalizedAddress}`,
        type: 'pool',
        attributes: {
          name: `${baseSymbol}/${quoteSymbol}`,
          pool_name: null,
          address: normalizedAddress,
          base_token_price_usd: baseTokenPriceUsd,
          quote_token_price_usd: quoteTokenPriceUsd,
          base_token_price_native_currency: price.toString(),
          quote_token_price_native_currency: priceInverse.toString(),
          base_token_price_quote_token: price.toString(),
          quote_token_price_base_token: priceInverse.toString(),
          pool_created_at: null,
          reserve_in_usd: totalLiquidityUsd.toFixed(2),
          fdv_usd: fdvUsd,
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
            data: { id: `${networkSlug}_${baseAddress.toLowerCase()}`, type: 'token' },
          },
          quote_token: {
            data: { id: `${networkSlug}_${quoteAddress.toLowerCase()}`, type: 'token' },
          },
          dex: {
            data: { id: `${networkSlug}_dex`, type: 'dex' },
          },
        },
      },
      included: [...includedTokens, dexInfo],
    };

    // Cache response for 30 seconds
    apiCache.set(cacheKey, response, CACHE_TTL.SHORT);

    return NextResponse.json(response, { headers: API_HEADERS });
  } catch (error) {
    console.error('GeckoTerminal Pool API error:', error);
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
