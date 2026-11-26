import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { getProviderUrl } from '@/lib/web3/provider';
import { loadConfig } from '@/lib/config';
import { enforceRateLimit } from '@/lib/security/rate-limits';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface NodeInfo {
  name: string;
  url: string;
  status: 'online' | 'offline' | 'syncing';
  latency: number;
  blockHeight: number;
  version: string;
  networkId: number;
  chainId: number;
  peerCount: number;
  isSyncing: boolean;
}

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, 'api');
  if (limited) return limited;

  try {
    const config = loadConfig();
    // Display the configured public RPC URL and query that same node so the
    // shown URL and the reported version/height always come from one source.
    const rpcUrl = config.network?.rpcUrl || getProviderUrl();
    const node = createPublicClient({ transport: http(rpcUrl, { timeout: 10_000 }) });
    const ask = <T>(method: string) => node.request({ method, params: [] } as never) as Promise<T>;

    const startTime = Date.now();

    let version = 'Unknown';
    try {
      version = await ask<string>('web3_clientVersion');
    } catch {
      console.log('Could not get node version');
    }

    let blockHeight = 0;
    try {
      blockHeight = Number(await node.getBlockNumber());
    } catch {
      console.log('Could not get block height');
    }

    let networkId = 0;
    try {
      networkId = Number(await ask<string>('net_version'));
    } catch {
      console.log('Could not get network ID');
    }

    let chainId = 0;
    try {
      chainId = await node.getChainId();
    } catch {
      console.log('Could not get chain ID');
    }

    let peerCount = 0;
    try {
      peerCount = Number(await ask<string>('net_peerCount'));
    } catch {
      console.log('Could not get peer count');
    }

    let isSyncing = false;
    try {
      isSyncing = (await ask<unknown>('eth_syncing')) !== false;
    } catch {
      console.log('Could not get sync status');
    }

    const latency = Date.now() - startTime;

    // Determine status
    let status: 'online' | 'offline' | 'syncing' = 'online';
    if (blockHeight === 0) {
      status = 'offline';
    } else if (isSyncing) {
      status = 'syncing';
    }

    const nodeInfo: NodeInfo = {
      name: 'Primary RPC',
      url: rpcUrl,
      status,
      latency,
      blockHeight,
      version,
      networkId,
      chainId,
      peerCount,
      isSyncing,
    };

    return NextResponse.json(nodeInfo, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=10',
      },
    });
  } catch (error) {
    console.error('Error fetching node info:', error);
    return NextResponse.json(
      {
        name: 'Primary RPC',
        url: getProviderUrl(),
        status: 'offline',
        latency: 0,
        blockHeight: 0,
        version: 'Unknown',
        networkId: 0,
        chainId: 0,
        peerCount: 0,
        isSyncing: false,
        error: 'Failed to fetch node info',
      },
      { status: 500 }
    );
  }
}
