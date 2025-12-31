import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config';
import { getExternalPriceData } from '@/lib/dex/external-price';
import { connectToDatabase } from '@/lib/db';

/**
 * DefiLlama Protocol Info API
 * Returns protocol information in DefiLlama-compatible format
 * 
 * GET /api/dex/defillama
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const config = loadConfig();
    const nativeSymbol = config.currency?.symbol || 'VBC';
    const chainName = config.network?.name || 'Virbicoin';
    
    // Get external price data
    const priceData = await getExternalPriceData();
    const nativePriceUsd = priceData.nativePriceUsd;
    
    // Get pool data from database
    let totalTvlUsd = priceData.totalTvlUsd; // Use DefiLlama TVL if available
    let pools: Array<{
      pool: string;
      chain: string;
      project: string;
      symbol: string;
      tvlUsd: number;
      underlyingTokens: string[];
    }> = [];

    try {
      const { db } = await connectToDatabase();
      const pairsCollection = db.collection('dex_pairs');
      const pairsData = await pairsCollection.find({}).toArray();
      
      if (pairsData.length > 0) {
        let calculatedTvl = 0;
        
        pools = pairsData.map((pair) => {
          // Calculate TVL in USD (liquidity is in native token)
          const liquidityInNative = parseFloat(pair.liquidity || '0');
          const tvlUsd = liquidityInNative * nativePriceUsd;
          calculatedTvl += tvlUsd;

          return {
            pool: pair.address,
            chain: chainName,
            project: `${chainName} DEX`,
            symbol: pair.name || `${pair.token0Symbol}-${pair.token1Symbol}`,
            tvlUsd: tvlUsd,
            underlyingTokens: [pair.token0, pair.token1].filter(Boolean),
          };
        });
        
        // If no external TVL, use calculated
        if (totalTvlUsd === 0) {
          totalTvlUsd = calculatedTvl;
        }
      }
    } catch (dbError) {
      console.error('Database error:', dbError);
      // Continue with external TVL data
    }

    // DefiLlama-compatible protocol response
    const response = {
      id: `${chainName.toLowerCase()}-dex`,
      name: `${chainName} DEX`,
      symbol: nativeSymbol,
      category: 'Dexes',
      chains: [chainName],
      tvl: totalTvlUsd,
      chainTvls: {
        [chainName]: totalTvlUsd,
      },
      url: config.explorer?.url || '',
      description: `Native DEX on ${chainName} blockchain`,
      logo: `/img/${nativeSymbol}.svg`,
      gecko_id: null,
      cmcId: null,
      twitter: config.social?.x || null,
      discord: config.social?.discord || null,
      telegram: config.social?.telegram || null,
      pools: pools,
      timestamp: Math.floor(Date.now() / 1000),
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
    console.error('DefiLlama API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch protocol data' },
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
