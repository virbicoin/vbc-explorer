import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config';
import {
  getNativePriceFromDex,
  getSecondaryPriceFromDex,
  getTokenPriceUsd,
  ADDRESSES,
  isStablecoin,
} from '@/lib/dex/priceUtils';
import { getLPAddresses, getCachedPoolInfo, getCachedTokenInfo } from '@/lib/dex/cache-service';
import { ethers } from 'ethers';

/**
 * DefiLlama Prices API
 * Returns token prices in DefiLlama-compatible format
 *
 * GET /api/dex/defillama/prices
 *
 * This endpoint provides data compatible with DefiLlama's coins API
 * Format similar to: GET /prices/current/{coins}
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface TokenPrice {
  decimals: number;
  symbol: string;
  price: number;
  timestamp: number;
  confidence: number;
}

interface PricesResponse {
  coins: Record<string, TokenPrice>;
}

export async function GET() {
  try {
    const config = loadConfig();
    const nativeSymbol = config.currency?.symbol || 'ETH';
    const chainName = config.network?.name || 'Virbicoin';

    // Get native and secondary token prices from DEX (not external API)
    const [nativePriceUsd, secondaryPriceUsd] = await Promise.all([
      getNativePriceFromDex(),
      getSecondaryPriceFromDex(),
    ]);

    const coins: Record<string, TokenPrice> = {};
    const timestamp = Math.floor(Date.now() / 1000);

    // Native token (zero address)
    coins[`${chainName.toLowerCase()}:${ADDRESSES.NATIVE}`] = {
      decimals: config.currency?.decimals || 18,
      symbol: nativeSymbol,
      price: nativePriceUsd,
      timestamp: timestamp,
      confidence: nativePriceUsd > 0 ? 0.99 : 0,
    };

    // Wrapped native token
    coins[`${chainName.toLowerCase()}:${ADDRESSES.WRAPPED_NATIVE}`] = {
      decimals: 18,
      symbol: `W${nativeSymbol}`,
      price: nativePriceUsd,
      timestamp: timestamp,
      confidence: nativePriceUsd > 0 ? 0.99 : 0,
    };

    // Secondary token (reward token)
    const secondarySymbol = config.dex?.rewardToken?.symbol || 'REWARD';
    coins[`${chainName.toLowerCase()}:${ADDRESSES.SECONDARY}`] = {
      decimals: 18,
      symbol: secondarySymbol,
      price: secondaryPriceUsd,
      timestamp: timestamp,
      confidence: secondaryPriceUsd > 0 ? 0.9 : 0,
    };

    // Stablecoin
    const stablecoinSymbol = config.dex?.usdt?.symbol || 'USDT';
    coins[`${chainName.toLowerCase()}:${ADDRESSES.STABLECOIN}`] = {
      decimals: config.dex?.usdt?.decimals || 6,
      symbol: stablecoinSymbol,
      price: 1.0, // Stablecoin is always 1.0
      timestamp: timestamp,
      confidence: 0.99,
    };

    // Calculate other token prices from DEX pairs
    try {
      const lpAddresses = await getLPAddresses();
      const processedTokens = new Set([
        ADDRESSES.NATIVE,
        ADDRESSES.WRAPPED_NATIVE,
        ADDRESSES.SECONDARY,
        ADDRESSES.STABLECOIN,
      ]);

      for (const lpAddress of lpAddresses) {
        try {
          const poolInfo = await getCachedPoolInfo(lpAddress);
          if (!poolInfo) continue;

          const { token0, token1, reserve0, reserve1 } = poolInfo;

          // Process token0 if not already processed
          const token0Addr = token0.address.toLowerCase();
          if (!processedTokens.has(token0Addr)) {
            const tokenPrice = await getTokenPriceUsd(token0Addr);
            if (tokenPrice > 0) {
              coins[`${chainName.toLowerCase()}:${token0Addr}`] = {
                decimals: token0.decimals,
                symbol: token0.symbol,
                price: tokenPrice,
                timestamp: timestamp,
                confidence: tokenPrice > 0 ? 0.9 : 0,
              };
              processedTokens.add(token0Addr);
            }
          }

          // Process token1 if not already processed
          const token1Addr = token1.address.toLowerCase();
          if (!processedTokens.has(token1Addr)) {
            const tokenPrice = await getTokenPriceUsd(token1Addr);
            if (tokenPrice > 0) {
              coins[`${chainName.toLowerCase()}:${token1Addr}`] = {
                decimals: token1.decimals,
                symbol: token1.symbol,
                price: tokenPrice,
                timestamp: timestamp,
                confidence: tokenPrice > 0 ? 0.9 : 0,
              };
              processedTokens.add(token1Addr);
            }
          }
        } catch {
          continue;
        }
      }
    } catch (fetchError) {
      console.error('Error calculating token prices:', fetchError);
    }

    const response: PricesResponse = { coins };

    return NextResponse.json(response, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'public, max-age=60', // 1 minute cache for prices
      },
    });
  } catch (error) {
    console.error('DefiLlama prices API error:', error);
    return NextResponse.json({ coins: {} }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
