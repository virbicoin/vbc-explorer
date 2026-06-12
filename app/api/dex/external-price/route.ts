import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config';
import { getNativePrice } from '@/lib/price-service';
import { connectDB } from '@/models/index';

// Cache for external price data (5 minute TTL)
let cachedData: {
  nativePriceUsd: number;
  nativeSymbol: string;
  totalTvlUsd: number;
  lastUpdated: number;
  source: {
    price: string;
    tvl: string;
  };
} | null = null;

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchDefiLlamaTvl(): Promise<number> {
  try {
    const response = await fetch('https://api.llama.fi/tvl/virbicoin-dex', {
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      throw new Error(`DefiLlama API error: ${response.status}`);
    }

    const tvl = await response.json();
    return typeof tvl === 'number' ? tvl : 0;
  } catch (error) {
    console.error('Failed to fetch DefiLlama TVL:', error);
    return 0;
  }
}

export async function GET() {
  try {
    // Connect to database for price service
    await connectDB();

    // Get native token symbol from config
    const config = loadConfig();
    const nativeSymbol = config.currency?.symbol || 'ETH';

    // Return cached data if still valid
    if (cachedData && Date.now() - cachedData.lastUpdated < CACHE_TTL) {
      return NextResponse.json({
        success: true,
        data: cachedData,
        cached: true,
      });
    }

    // Get price from price service (uses Market DB first, then WikaEx)
    const [priceData, totalTvlUsd] = await Promise.all([getNativePrice(), fetchDefiLlamaTvl()]);

    const nativePriceUsd = priceData?.priceUSD || 0;
    const priceSource = priceData?.source === 'database' ? 'Market DB' : 'WikaEx';

    cachedData = {
      nativePriceUsd,
      nativeSymbol,
      totalTvlUsd,
      lastUpdated: Date.now(),
      source: {
        price: priceSource,
        tvl: 'DefiLlama',
      },
    };

    return NextResponse.json({
      success: true,
      data: cachedData,
      cached: false,
    });
  } catch (error) {
    console.error('External price API error:', error);

    // Return cached data even if expired, as fallback
    if (cachedData) {
      return NextResponse.json({
        success: true,
        data: cachedData,
        cached: true,
        stale: true,
      });
    }

    return NextResponse.json(
      { success: false, error: 'Failed to fetch external price data' },
      { status: 500 }
    );
  }
}
