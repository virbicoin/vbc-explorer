import { NextResponse } from 'next/server';
import { loadConfig } from '../../../../lib/config';

export async function GET() {
  try {
    const config = loadConfig();
    
    // Return only the necessary config for client-side
    // Use Ethereum-compatible defaults as fallback
    return NextResponse.json({
      currency: {
        name: config.currency?.name || 'Ethereum',
        symbol: config.currency?.symbol || 'ETH',
        unit: config.currency?.unit || 'wei',
        decimals: config.currency?.decimals || 18,
        gasUnit: config.currency?.gasUnit || 'Gwei',
        icon: config.currency?.icon || null,
        color: config.currency?.color || 'from-gray-500 to-gray-600'
      },
      explorer: {
        name: config.explorer?.name || 'Blockchain Explorer',
        description: config.explorer?.description || 'Real-time blockchain explorer'
      },
      miners: config.miners || {},
      // Network configuration for DEX and other client-side features
      network: {
        chainId: config.network?.chainId || 1,
        name: config.network?.name || 'Ethereum',
        rpcUrl: config.network?.rpcUrl || 'http://localhost:8545',
        wsUrl: config.network?.wsUrl || '',
        explorer: config.network?.explorer || '',
        blockTime: config.network?.blockTime || 12
      },
      // DEX configuration with full token info
      dex: config.dex ? {
        enabled: config.dex.enabled || false,
        factory: config.dex.factory || '',
        router: config.dex.router || '',
        masterChef: config.dex.masterChef || '',
        wrappedNative: config.dex.wrappedNative || null,
        rewardToken: config.dex.rewardToken || null,
        // Additional token definitions (USDT, VBCG, etc.)
        tokens: config.dex.tokens || {},
        // LP token addresses
        lpTokens: config.dex.lpTokens || {},
        // Farm pool configurations
        farmPools: config.dex.farmPools || []
      } : null,
      // Social links
      social: config.social || null
    });
  } catch (error) {
    console.error('Error loading config for client:', error);
    // Ethereum-compatible defaults on error
    return NextResponse.json({
      currency: {
        name: 'Ethereum',
        symbol: 'ETH',
        unit: 'wei',
        decimals: 18,
        gasUnit: 'Gwei'
      },
      explorer: {
        name: 'Blockchain Explorer',
        description: 'Real-time blockchain explorer'
      },
      miners: {},
      network: null,
      dex: null,
      social: null
    }, { status: 500 });
  }
} 