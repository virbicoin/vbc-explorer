import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config';
import { getExternalPriceData } from '@/lib/dex/external-price';
import { headers } from 'next/headers';

/**
 * DefiLlama Pools API
 * Returns pool information in DefiLlama yields-compatible format
 *
 * GET /api/dex/defillama/pools
 *
 * This endpoint provides data compatible with DefiLlama's yields dashboard
 * Format: https://yields.llama.fi/pools
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

interface Pool {
  pool: string; // unique pool id
  chain: string; // chain name
  project: string; // project name
  symbol: string; // pool symbol (e.g., "VBC-USDT")
  tvlUsd: number; // TVL in USD
  apyBase?: number; // base APY from trading fees
  apyReward?: number; // reward APY from farming
  apy?: number; // total APY
  rewardTokens?: string[]; // reward token addresses
  underlyingTokens: string[]; // underlying token addresses
  poolMeta?: string; // optional metadata
  il7d?: number; // 7-day impermanent loss
  apyBase7d?: number; // 7-day base APY
  volumeUsd1d?: number; // 24h volume in USD
  volumeUsd7d?: number; // 7-day volume in USD
  apyBaseInception?: number; // APY since inception
}

export async function GET() {
  try {
    const config = loadConfig();
    const chainName = config.network?.name || 'Virbicoin';

    // Get external price data
    const priceData = await getExternalPriceData();
    const nativePriceUsd = priceData.nativePriceUsd;

    // Get reward token info from DEX config
    const rewardTokenAddress = config.dex?.rewardToken?.address;
    const rewardTokens = rewardTokenAddress ? [rewardTokenAddress] : [];

    const pools: Pool[] = [];

    try {
      const baseUrl = await getBaseUrl();
      const pairsResponse = await fetch(`${baseUrl}/api/dex/pairs`, {
        cache: 'no-store',
      });

      if (pairsResponse.ok) {
        const pairsData = await pairsResponse.json();
        const pairsArray = pairsData.data?.pairs || pairsData.data || [];

        for (const pair of pairsArray) {
          // Calculate TVL in USD (liquidity is in wei)
          const liquidityInNative = parseFloat(pair.liquidity || '0') / 1e18;
          const tvlUsd = liquidityInNative * nativePriceUsd;

          pools.push({
            pool: `${chainName.toLowerCase()}-${pair.address}`.toLowerCase(),
            chain: chainName,
            project: `${chainName} DEX`,
            symbol: pair.name,
            tvlUsd: tvlUsd,
            apyBase: 0, // Would calculate from fees/volume
            apyReward: 0, // Would get from farming contracts
            apy: 0,
            rewardTokens: rewardTokens,
            underlyingTokens: [pair.baseToken?.address, pair.quoteToken?.address].filter(Boolean),
            poolMeta: undefined,
            volumeUsd1d: 0,
            volumeUsd7d: 0,
          });
        }
      }
    } catch (fetchError) {
      console.error('Fetch error:', fetchError);
    }

    // DefiLlama pools response format
    const response = {
      status: 'ok',
      data: pools,
    };

    return NextResponse.json(response, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'public, max-age=300', // 5 minute cache
      },
    });
  } catch (error) {
    console.error('DefiLlama pools API error:', error);
    return NextResponse.json({ status: 'error', data: [] }, { status: 500 });
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
