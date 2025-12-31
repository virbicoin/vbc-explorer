import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config';
import { getExternalPriceData } from '@/lib/dex/external-price';
import { connectToDatabase } from '@/lib/db';

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
      const { db } = await connectToDatabase();
      const pairsCollection = db.collection('dex_pairs');
      const pairsData = await pairsCollection.find({}).toArray();
      
      const tokenPrices: Map<string, { price: number; symbol: string; decimals: number }> = new Map();
      
      for (const pair of pairsData) {
        const token0 = pair.token0?.toLowerCase();
        const token1 = pair.token1?.toLowerCase();
        const price = parseFloat(pair.price || '0');
        const wrappedAddr = wrappedNativeAddress?.toLowerCase();
        
        // If one token is native/wrapped native, calculate the other's price
        if ((token0 === nativeAddress || token0 === wrappedAddr) && price > 0) {
          // Quote token price = native price / price ratio
          const quotePriceUsd = nativePriceUsd / price;
          if (!tokenPrices.has(token1) || tokenPrices.get(token1)!.price === 0) {
            tokenPrices.set(token1, {
              price: quotePriceUsd,
              symbol: pair.token1Symbol || 'UNKNOWN',
              decimals: pair.token1Decimals || 18,
            });
          }
        }
        
        if ((token1 === nativeAddress || token1 === wrappedAddr) && price > 0) {
          // Base token price = native price * price
          const basePriceUsd = nativePriceUsd * price;
          if (!tokenPrices.has(token0) || tokenPrices.get(token0)!.price === 0) {
            tokenPrices.set(token0, {
              price: basePriceUsd,
              symbol: pair.token0Symbol || 'UNKNOWN',
              decimals: pair.token0Decimals || 18,
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
      
      // Also get token prices from tokens collection
      const tokensCollection = db.collection('tokens');
      const tokens = await tokensCollection.find({}).toArray();
      
      for (const token of tokens) {
        const addr = token.address?.toLowerCase();
        if (addr && !coins[`${chainName.toLowerCase()}:${addr}`]) {
          // If token has USD price in DB, use it
          if (token.priceUsd && token.priceUsd > 0) {
            coins[`${chainName.toLowerCase()}:${addr}`] = {
              decimals: token.decimals || 18,
              symbol: token.symbol || 'UNKNOWN',
              price: token.priceUsd,
              timestamp: timestamp,
              confidence: 0.8,
            };
          }
        }
      }
    } catch (dbError) {
      console.error('Database error:', dbError);
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
    return NextResponse.json(
      { coins: {} },
      { status: 500 }
    );
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
