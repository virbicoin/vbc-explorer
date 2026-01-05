import { NextResponse } from 'next/server';
import { getWeb3, getProviderUrl } from '@/lib/web3/provider';
import { loadConfig } from '@/lib/config';

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

export async function GET() {
  try {
    const web3 = getWeb3();
    const config = loadConfig();
    // Use network.rpcUrl from config for display, fallback to web3Provider.url
    const rpcUrl = config.network?.rpcUrl || getProviderUrl();

    const startTime = Date.now();

    // Get node version using web3_clientVersion
    let version = 'Unknown';
    try {
      version = await web3.eth.getNodeInfo();
    } catch {
      // Fallback: try direct RPC call
      try {
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'web3_clientVersion',
            params: [],
            id: 1,
          }),
        });
        const data = await response.json();
        if (data.result) {
          version = data.result;
        }
      } catch {
        console.log('Could not get node version');
      }
    }

    // Get block height
    let blockHeight = 0;
    try {
      blockHeight = Number(await web3.eth.getBlockNumber());
    } catch {
      console.log('Could not get block height');
    }

    // Get network ID
    let networkId = 0;
    try {
      networkId = Number(await web3.eth.net.getId());
    } catch {
      console.log('Could not get network ID');
    }

    // Get chain ID
    let chainId = 0;
    try {
      chainId = Number(await web3.eth.getChainId());
    } catch {
      console.log('Could not get chain ID');
    }

    // Get peer count
    let peerCount = 0;
    try {
      peerCount = Number(await web3.eth.net.getPeerCount());
    } catch {
      console.log('Could not get peer count');
    }

    // Check if syncing
    let isSyncing = false;
    try {
      const syncStatus = await web3.eth.isSyncing();
      isSyncing = syncStatus !== false;
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
