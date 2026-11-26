// GeckoTerminal DEX Info API - Returns DEX metadata
import { NextResponse } from 'next/server';
import { loadConfig, getNetworkName, getChainId } from '@/lib/config';

export const dynamic = 'force-dynamic';

interface DexInfo {
  name: string;
  logo: string;
  website: string;
  description: string;
  network: {
    name: string;
    chain_id: number;
    native_currency: {
      name: string;
      symbol: string;
      decimals: number;
    };
    rpc_url: string;
    explorer_url: string;
  };
  contracts: {
    factory: string;
    router: string;
  };
  social: {
    twitter?: string;
    telegram?: string;
    discord?: string;
    documentation?: string;
  };
  features: {
    swap: boolean;
    liquidity: boolean;
    farming: boolean;
    launchpad: boolean;
  };
}

export async function GET() {
  try {
    const config = loadConfig();
    const networkName = getNetworkName();
    const explorerUrl = config.explorer?.url || '';

    const dexInfo: DexInfo = {
      name: config.dex?.name || config.dexInfo?.name || `${networkName} DEX`,
      logo: config.dexInfo?.logo || '',
      website: config.dexInfo?.url || (explorerUrl ? `${explorerUrl}/dex` : ''),
      description: `Decentralized exchange on ${networkName} network. Swap tokens, provide liquidity, and earn rewards through yield farming.`,
      network: {
        name: networkName,
        chain_id: getChainId(),
        native_currency: {
          name: config.currency?.name || 'Ether',
          symbol: config.currency?.symbol || 'ETH',
          decimals: config.currency?.decimals || 18,
        },
        rpc_url: config.network?.rpcUrl || '',
        explorer_url: explorerUrl,
      },
      contracts: {
        factory: config.dex?.factory || '',
        router: config.dex?.router || '',
      },
      social: {
        twitter: config.social?.x,
        telegram: config.social?.telegram,
        discord: config.social?.discord,
        documentation:
          config.dexInfo?.docsUrl || (explorerUrl ? `${explorerUrl}/dex/docs` : undefined),
      },
      features: {
        swap: true,
        liquidity: true,
        farming: !!config.dex?.masterChef,
        launchpad: config.launchpad?.enabled || false,
      },
    };

    return NextResponse.json(
      {
        data: dexInfo,
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300',
        },
      }
    );
  } catch (error) {
    console.error('GeckoTerminal Info API error:', error);
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
