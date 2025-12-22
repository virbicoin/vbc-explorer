/**
 * Total Supply API Endpoint
 * 
 * Returns the total supply of VirBiCoin as plain text (number only).
 * Required format for CoinGecko and CoinMarketCap integration.
 * 
 * GET /api/total_supply
 * Response: Plain text number (e.g., "330000000")
 */

import { NextResponse, type NextRequest } from 'next/server';
import { calculateTotalSupply, getSupplyDetails } from '@/lib/supply';

// Cache headers for CDN optimization
const CACHE_MAX_AGE = 60; // 1 minute
const STALE_WHILE_REVALIDATE = 120; // 2 minutes

export async function GET(request: NextRequest) {
  try {
    // Check for debug mode (returns JSON with details)
    const { searchParams } = new URL(request.url);
    const debug = searchParams.get('debug') === 'true';
    
    if (debug) {
      const details = await getSupplyDetails();
      return NextResponse.json(details, {
        headers: {
          'Cache-Control': `public, max-age=${CACHE_MAX_AGE}, s-maxage=${CACHE_MAX_AGE}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
        },
      });
    }
    
    // Calculate total supply
    const totalSupply = await calculateTotalSupply();
    
    // Return as plain text (number only) - required format for CoinGecko/CMC
    return new NextResponse(totalSupply.toString(), {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': `public, max-age=${CACHE_MAX_AGE}, s-maxage=${CACHE_MAX_AGE}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
      },
    });
  } catch (error) {
    console.error('[Total Supply API] Error:', error);
    
    // Return error as plain text to maintain format consistency
    return new NextResponse('Error calculating total supply', {
      status: 500,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}

// Handle OPTIONS for CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
