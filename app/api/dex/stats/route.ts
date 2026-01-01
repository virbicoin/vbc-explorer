import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config';
import { getLPAddresses, getCachedPoolInfo, getCachedPoolStats } from '@/lib/dex/cache-service';
import { getVbcPriceFromDex, getVbcgPriceFromDex, calculatePoolTvlUsd, ADDRESSES } from '@/lib/dex/priceUtils';
import { connectDB, DexSwap } from '@/models/index';
import { ethers } from 'ethers';

/**
 * DEX Stats API
 * Returns comprehensive DEX statistics
 *
 * GET /api/dex/stats
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const config = loadConfig();
    const chainName = config.network?.name || 'Virbicoin';
    const chainId = config.network?.chainId || 329;

    // Get prices from DEX
    const [vbcPriceUsd, vbcgPriceUsd] = await Promise.all([
      getVbcPriceFromDex(),
      getVbcgPriceFromDex(),
    ]);

    // Calculate total TVL and volume from all pools
    const lpAddresses = getLPAddresses();
    let totalTvlUsd = 0;
    let totalVolume24h = 0;
    let totalTxCount24h = 0;
    let totalBuys24h = 0;
    let totalSells24h = 0;
    const poolsData: Array<{
      address: string;
      name: string;
      tvlUsd: number;
      volume24h: number;
      txCount24h: number;
    }> = [];

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

        // Get pool stats
        const poolStats = await getCachedPoolStats(lpAddress);
        const volume24h = poolStats?.volume?.h24 || 0;
        const txCount24h = poolStats?.txCount?.h24 || 0;
        const buys24h = poolStats?.buys?.h24 || 0;
        const sells24h = poolStats?.sells?.h24 || 0;

        totalVolume24h += volume24h;
        totalTxCount24h += txCount24h;
        totalBuys24h += buys24h;
        totalSells24h += sells24h;

        // Format pool name
        const symbol0 = token0.symbol === 'WVBC' ? 'VBC' : token0.symbol;
        const symbol1 = token1.symbol === 'WVBC' ? 'VBC' : token1.symbol;

        poolsData.push({
          address: lpAddress,
          name: `${symbol0}/${symbol1}`,
          tvlUsd: tvl,
          volume24h: volume24h,
          txCount24h: txCount24h,
        });
      } catch {
        continue;
      }
    }

    // Calculate fees (0.3% of volume)
    const totalFees24h = totalVolume24h * 0.003;

    // Get unique traders count (last 24h)
    let uniqueTraders24h = 0;
    try {
      await connectDB();
      const h24Ago = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
      const traders = await DexSwap.distinct('sender', {
        timestamp: { $gte: h24Ago },
      });
      uniqueTraders24h = traders.length;
    } catch {
      // Ignore
    }

    const response = {
      chain: chainName,
      chainId: chainId,
      timestamp: Math.floor(Date.now() / 1000),
      prices: {
        vbc: vbcPriceUsd,
        wvbc: vbcPriceUsd,
        vbcg: vbcgPriceUsd,
        usdt: 1.0,
      },
      tvl: {
        total: totalTvlUsd,
        byPool: poolsData.map(p => ({ address: p.address, name: p.name, tvlUsd: p.tvlUsd })),
      },
      volume: {
        h24: totalVolume24h,
        byPool: poolsData.map(p => ({ address: p.address, name: p.name, volume24h: p.volume24h })),
      },
      fees: {
        h24: totalFees24h,
        feeRate: 0.003, // 0.3%
      },
      transactions: {
        h24: totalTxCount24h,
        buys24h: totalBuys24h,
        sells24h: totalSells24h,
      },
      users: {
        uniqueTraders24h: uniqueTraders24h,
      },
      pools: {
        count: lpAddresses.length,
        list: poolsData,
      },
      contracts: {
        factory: config.dex?.factory || ADDRESSES.FACTORY,
        router: config.dex?.router || ADDRESSES.ROUTER,
        masterChef: ADDRESSES.MASTERCHEF,
        wvbc: ADDRESSES.WVBC,
        vbcg: ADDRESSES.VBCG,
        usdt: ADDRESSES.USDT,
      },
    };

    return NextResponse.json(response, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'public, max-age=60', // 1 minute cache
      },
    });
  } catch (error) {
    console.error('DEX Stats API error:', error);
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
