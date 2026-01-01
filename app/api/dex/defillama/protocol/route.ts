import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config';
import { getLPAddresses, getCachedPoolInfo, getCachedPoolStats } from '@/lib/dex/cache-service';
import { getVbcPriceFromDex, calculatePoolTvlUsd, ADDRESSES } from '@/lib/dex/priceUtils';
import { ethers } from 'ethers';

/**
 * DefiLlama Protocol API
 * Returns protocol information in DefiLlama-compatible format
 *
 * GET /api/dex/defillama/protocol
 *
 * Format: https://defillama.com/docs/api
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const config = loadConfig();
    const chainName = config.network?.name || 'Virbicoin';
    const chainId = config.network?.chainId || 329;

    // Get VBC price from DEX
    const vbcPriceUsd = await getVbcPriceFromDex();

    // Calculate total TVL from all pools
    const lpAddresses = getLPAddresses();
    let totalTvlUsd = 0;
    let totalVolume24h = 0;
    const poolCount = lpAddresses.length;

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

        // Get 24h volume
        const poolStats = await getCachedPoolStats(lpAddress);
        if (poolStats?.volume?.h24) {
          totalVolume24h += poolStats.volume.h24;
        }
      } catch {
        continue;
      }
    }

    const response = {
      id: `${chainName.toLowerCase()}-dex`,
      name: `${chainName} DEX`,
      address: config.dex?.factory || ADDRESSES.FACTORY,
      symbol: config.currency?.symbol || 'VBC',
      url: config.network?.explorer || 'https://explorer.digitalregion.jp',
      description: `Decentralized Exchange on ${chainName} Network`,
      chain: chainName,
      logo: null,
      audits: '0',
      audit_note: null,
      gecko_id: null,
      cmcId: null,
      category: 'Dexes',
      chains: [chainName],
      module: `${chainName.toLowerCase()}-dex`,
      twitter: null,
      forkedFrom: ['Uniswap V2'],
      oracles: [],
      listedAt: Math.floor(Date.now() / 1000),
      methodology:
        'TVL is calculated by summing the USD value of all tokens locked in liquidity pools.',
      chainTvls: {
        [chainName]: totalTvlUsd,
      },
      tvl: totalTvlUsd,
      change_1h: null,
      change_1d: null,
      change_7d: null,
      tokenBreakdowns: {},
      mcap: null,
      currentChainTvls: {
        [chainName]: totalTvlUsd,
      },
      volume24h: totalVolume24h,
      fees24h: totalVolume24h * 0.003, // 0.3% fee
      poolCount: poolCount,
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
    console.error('DefiLlama protocol API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
