// GeckoTerminal Networks API - Returns network/chain information
// Format: https://docs.geckoterminal.com/reference/get_networks
import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GeckoTerminal API headers
const API_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type',
  'Cache-Control': 'public, max-age=3600',
  'X-API-Version': '20230203',
};

// GeckoTerminal error response format
function errorResponse(status: number, title: string) {
  return NextResponse.json(
    { errors: [{ status: String(status), title }] },
    { status, headers: API_HEADERS }
  );
}

export async function GET() {
  try {
    const config = loadConfig();

    if (!config.dex?.enabled) {
      return errorResponse(404, 'DEX feature is not enabled');
    }

    const networkSlug = config.network?.slug || 'ethereum';
    const chainId = config.network?.chainId || 1;
    const networkName = config.network?.name || 'Ethereum';
    const currencySymbol = config.currency?.symbol || 'ETH';

    return NextResponse.json(
      {
        data: [
          {
            id: networkSlug,
            type: 'network',
            attributes: {
              name: networkName,
              short_name: currencySymbol,
              coingecko_asset_platform_id: null,
              identifier: networkSlug,
              chain_id: chainId,
              native_coin_id: null,
              image_url: null,
            },
          },
        ],
      },
      { headers: API_HEADERS }
    );
  } catch (error) {
    console.error('GeckoTerminal Networks API error:', error);
    return errorResponse(500, 'Internal server error');
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept, Content-Type',
    },
  });
}
