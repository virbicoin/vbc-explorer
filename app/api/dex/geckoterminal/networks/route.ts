// GeckoTerminal Networks API - Returns network/chain information
// Format: https://docs.geckoterminal.com/reference/get_networks
import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const config = loadConfig();

    if (!config.dex?.enabled) {
      return NextResponse.json({ error: 'DEX feature is not enabled' }, { status: 404 });
    }

    const networkSlug = 'virbicoin';
    const chainId = config.network?.chainId || 329;

    return NextResponse.json(
      {
        data: [
          {
            id: networkSlug,
            type: 'network',
            attributes: {
              name: 'VirBiCoin',
              short_name: 'VBC',
              coingecko_asset_platform_id: null,
              identifier: networkSlug,
              chain_id: chainId,
              native_coin_id: null,
              image_url: null,
            },
          },
        ],
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
        },
      }
    );
  } catch (error) {
    console.error('GeckoTerminal Networks API error:', error);
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
