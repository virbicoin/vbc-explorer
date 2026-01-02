import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config';
import { getLPAddresses, getCachedPoolInfo } from '@/lib/dex/cache-service';
import { calculatePoolTvlUsd } from '@/lib/dex/priceUtils';

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
    const config = loadConfig();
    const chainName = config.network?.name || 'Virbicoin';

    // Calculate total TVL from all pools using DEX prices
    const lpAddresses = await getLPAddresses();
    let totalTvlUsd = 0;

    for (const lpAddress of lpAddresses) {
      try {
        const poolInfo = await getCachedPoolInfo(lpAddress);
        if (!poolInfo) continue;

        const { token0, token1, reserve0, reserve1 } = poolInfo;
        const tvl = await calculatePoolTvlUsd(
          reserve0,
          reserve1,
          token0.address,
          token1.address,
          token0.decimals,
          token1.decimals
        );
        totalTvlUsd += tvl;
      } catch {
        continue;
      }
    }

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
    return NextResponse.json({ error: 'Failed to fetch TVL data' }, { status: 500 });
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
