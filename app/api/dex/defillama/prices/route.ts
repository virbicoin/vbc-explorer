import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config';
import { getExternalPriceData } from '@/lib/dex/external-price';
import { headers } from 'next/headers';

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

// Helper function to get base URL
async function getBaseUrl(): Promise<string> {
  const headersList = await headers();
  const host = headersList.get('host') || 'localhost:3000';
  const protocol = headersList.get('x-forwarded-proto') || 'http';
  return `${protocol}://${host}`;
}

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
    const nativeSymbol = config.currency?.symbol || 'VBC';
    const chainName = config.network?.name || 'Virbicoin';

    // Get external price data
    const priceData = await getExternalPriceData();
    const nativePriceUsd = priceData.nativePriceUsd;

    const coins: Record<string, TokenPrice> = {};
    const timestamp = Math.floor(Date.now() / 1000);

    // Add native token price
    const nativeAddress = '0x0000000000000000000000000000000000000000';
    const wrappedNativeAddress = config.dex?.wrappedNative?.address;

    // Native token
    coins[`${chainName.toLowerCase()}:${nativeAddress}`] = {
      decimals: config.currency?.decimals || 18,
      symbol: nativeSymbol,
      price: nativePriceUsd,
      timestamp: timestamp,
      confidence: nativePriceUsd > 0 ? 0.99 : 0,
    };

    // Wrapped native token
    if (wrappedNativeAddress) {
      coins[`${chainName.toLowerCase()}:${wrappedNativeAddress.toLowerCase()}`] = {
        decimals: config.dex?.wrappedNative?.decimals || 18,
        symbol: `W${nativeSymbol}`,
        price: nativePriceUsd,
        timestamp: timestamp,
        confidence: nativePriceUsd > 0 ? 0.99 : 0,
      };
    }

    // Calculate other token prices from DEX pairs
    try {
      const baseUrl = await getBaseUrl();
      const pairsResponse = await fetch(`${baseUrl}/api/dex/pairs`, {
        cache: 'no-store',
      });

      if (pairsResponse.ok) {
        const pairsData = await pairsResponse.json();
        const pairsArray = pairsData.data?.pairs || pairsData.data || [];

        const tokenPrices: Map<string, { price: number; symbol: string; decimals: number }> =
          new Map();

        for (const pair of pairsArray) {
          const token0 = pair.baseToken?.address?.toLowerCase();
          const token1 = pair.quoteToken?.address?.toLowerCase();
          const price = parseFloat(pair.price || '0');
          const wrappedAddr = wrappedNativeAddress?.toLowerCase();

          // If quote token is native/wrapped native, base token price = native price * price
          if ((token1 === nativeAddress || token1 === wrappedAddr) && price > 0 && token0) {
            const basePriceUsd = nativePriceUsd * price;
            if (!tokenPrices.has(token0) || tokenPrices.get(token0)!.price === 0) {
              tokenPrices.set(token0, {
                price: basePriceUsd,
                symbol: pair.baseToken?.symbol || 'UNKNOWN',
                decimals: pair.baseToken?.decimals || 18,
              });
            }
          }

          // If base token is native/wrapped native, quote token price = native price / price
          if ((token0 === nativeAddress || token0 === wrappedAddr) && price > 0 && token1) {
            const quotePriceUsd = nativePriceUsd / price;
            if (!tokenPrices.has(token1) || tokenPrices.get(token1)!.price === 0) {
              tokenPrices.set(token1, {
                price: quotePriceUsd,
                symbol: pair.quoteToken?.symbol || 'UNKNOWN',
                decimals: pair.quoteToken?.decimals || 18,
              });
            }
          }
        }

        // Add calculated token prices
        for (const [address, data] of tokenPrices) {
          if (address !== nativeAddress && address !== wrappedNativeAddress?.toLowerCase()) {
            coins[`${chainName.toLowerCase()}:${address}`] = {
              decimals: data.decimals,
              symbol: data.symbol,
              price: data.price,
              timestamp: timestamp,
              confidence: data.price > 0 ? 0.9 : 0,
            };
          }
        }
      }
    } catch (fetchError) {
      console.error('Fetch error:', fetchError);
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
