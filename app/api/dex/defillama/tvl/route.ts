import { NextResponse } from 'next/server';
import { getExternalPriceData } from '@/lib/dex/external-price';

/**
 * DefiLlama TVL API
 * Returns current TVL in DefiLlama-compatible format
 * 
 * GET /api/dex/defillama/tvl
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    // Get external price data
    const priceData = await getExternalPriceData();
    const totalTvlUsd = priceData.totalTvlUsd;

    // DefiLlama TVL response format (simple number)
    // This matches: GET /tvl/{protocol}
    return new NextResponse(totalTvlUsd.toString(), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'public, max-age=300', // 5 minute cache
      },
    });
  } catch (error) {
    console.error('DefiLlama TVL API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch TVL data' },
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
