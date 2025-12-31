import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config';
import { getExternalPriceData } from '@/lib/dex/external-price';
import { headers } from 'next/headers';

/**
 * DefiLlama Protocol Info API
 * Returns protocol information in DefiLlama-compatible format
 *
 * GET /api/dex/defillama
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

export async function GET() {
  try {
    const config = loadConfig();
    const nativeSymbol = config.currency?.symbol || 'VBC';
    const chainName = config.network?.name || 'Virbicoin';

    // Get external price data
    const priceData = await getExternalPriceData();
    const nativePriceUsd = priceData.nativePriceUsd;

    // Get pool data from pairs API
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
      const baseUrl = await getBaseUrl();
      const pairsResponse = await fetch(`${baseUrl}/api/dex/pairs`, {
        cache: 'no-store',
      });

      if (pairsResponse.ok) {
        const pairsData = await pairsResponse.json();
        const pairsArray = pairsData.data?.pairs || pairsData.data || [];
        const wrappedNativeAddress = pairsData.data?.wrappedNativeAddress?.toLowerCase() || '';

        // Get known stablecoin symbols
        const STABLECOIN_SYMBOLS = new Set(['USDT', 'USDC', 'DAI', 'BUSD']);

        if (Array.isArray(pairsArray) && pairsArray.length > 0) {
          let calculatedTvl = 0;

          pools = pairsArray.map(
            (pair: {
              address: string;
              name: string;
              reserve0: string;
              reserve1: string;
              baseToken: { address: string; symbol: string; decimals: number };
              quoteToken: { address: string; symbol: string; decimals: number };
            }) => {
              // Calculate TVL from reserves
              const reserve0 =
                Number(BigInt(pair.reserve0 || '0')) / Math.pow(10, pair.baseToken?.decimals || 18);
              const reserve1 =
                Number(BigInt(pair.reserve1 || '0')) /
                Math.pow(10, pair.quoteToken?.decimals || 18);

              let tvlUsd = 0;

              // Check token types
              const baseIsStablecoin = STABLECOIN_SYMBOLS.has(
                pair.baseToken?.symbol?.toUpperCase()
              );
              const quoteIsStablecoin = STABLECOIN_SYMBOLS.has(
                pair.quoteToken?.symbol?.toUpperCase()
              );
              const quoteIsNative =
                pair.quoteToken?.address?.toLowerCase() === wrappedNativeAddress;

              if (baseIsStablecoin) {
                // Base token is stablecoin, use its reserve * 2
                tvlUsd = reserve0 * 2;
              } else if (quoteIsStablecoin) {
                // Quote token is stablecoin, use its reserve * 2
                tvlUsd = reserve1 * 2;
              } else if (quoteIsNative) {
                // Quote token is wrapped native, calculate from native price
                tvlUsd = reserve1 * nativePriceUsd * 2;
              } else {
                // Fallback: estimate from native price
                tvlUsd = (reserve0 + reserve1) * nativePriceUsd;
              }

              calculatedTvl += tvlUsd;

              return {
                pool: pair.address,
                chain: chainName,
                project: `${chainName} DEX`,
                symbol: pair.name,
                tvlUsd: tvlUsd,
                underlyingTokens: [pair.baseToken?.address, pair.quoteToken?.address].filter(
                  Boolean
                ),
              };
            }
          );

          // Always use our calculated TVL
          totalTvlUsd = calculatedTvl;
        }
      }
    } catch (fetchError) {
      console.error('Fetch error:', fetchError);
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
    return NextResponse.json({ error: 'Failed to fetch protocol data' }, { status: 500 });
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
