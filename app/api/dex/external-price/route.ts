import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config';

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

async function fetchExbitronPrice(nativeSymbol: string): Promise<number> {
  try {
    const response = await fetch('https://api.exbitron.com/api/v1/cg/tickers', {
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      throw new Error(`Exbitron API error: ${response.status}`);
    }

    const tickers = await response.json();

    // Find native token / USDT ticker (e.g., VBC-USDT)
    const nativeUsdt = tickers.find(
      (t: { ticker_id: string }) => t.ticker_id === `${nativeSymbol}-USDT`
    );

    if (nativeUsdt && nativeUsdt.last_price) {
      return parseFloat(nativeUsdt.last_price);
    }

    return 0;
  } catch (error) {
    console.error('Failed to fetch Exbitron price:', error);
    return 0;
  }
}

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
    // Get native token symbol from config
    const config = loadConfig();
    const nativeSymbol = config.currency?.symbol || 'VBC';

    // Return cached data if still valid
    if (cachedData && Date.now() - cachedData.lastUpdated < CACHE_TTL) {
      return NextResponse.json({
        success: true,
        data: cachedData,
        cached: true,
      });
    }

    // Fetch from both sources in parallel
    const [nativePriceUsd, totalTvlUsd] = await Promise.all([
      fetchExbitronPrice(nativeSymbol),
      fetchDefiLlamaTvl(),
    ]);

    cachedData = {
      nativePriceUsd,
      nativeSymbol,
      totalTvlUsd,
      lastUpdated: Date.now(),
      source: {
        price: 'Exbitron',
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
