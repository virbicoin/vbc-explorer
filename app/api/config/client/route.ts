import { NextResponse } from 'next/server';
import { loadConfig } from '../../../../lib/config';

// Type for tokenIcons config
interface TokenIconEntry {
  icon?: string;
  color?: string;
}

export async function GET() {
  try {
    const config = loadConfig();

    // Get tokenIcons from config (centralized icon/color definitions)
    const tokenIcons = (config as { tokenIcons?: Record<string, TokenIconEntry> }).tokenIcons || {};
    
    // Helper to get icon/color from tokenIcons by symbol
    const getIconConfig = (symbol: string): TokenIconEntry => tokenIcons[symbol] || {};
    
    // Get native token symbol
    const nativeSymbol = config.currency?.symbol || 'ETH';
    const wrappedSymbol = config.dex?.wrappedNative?.symbol || `W${nativeSymbol}`;
    const rewardSymbol = config.dex?.rewardToken?.symbol;

    // Return only the necessary config for client-side
    // Use Ethereum-compatible defaults as fallback
    return NextResponse.json({
      currency: {
        name: config.currency?.name || 'Ethereum',
        symbol: nativeSymbol,
        unit: config.currency?.unit || 'wei',
        decimals: config.currency?.decimals || 18,
        gasUnit: config.currency?.gasUnit || 'Gwei',
        icon: getIconConfig(nativeSymbol).icon || null,
        color: getIconConfig(nativeSymbol).color || 'from-gray-500 to-gray-600',
      },
      explorer: {
        name: config.explorer?.name || 'Blockchain Explorer',
        description: config.explorer?.description || 'Real-time blockchain explorer',
      },
      miners: config.miners || {},
      // Network configuration for DEX and other client-side features
      network: {
        chainId: config.network?.chainId || 1,
        name: config.network?.name || 'Ethereum',
        rpcUrl: config.network?.rpcUrl || 'http://localhost:8545',
        wsUrl: config.network?.wsUrl || '',
        explorer: config.network?.explorer || '',
        blockTime: config.network?.blockTime || 12,
      },
      // Centralized token icons configuration
      tokenIcons,
      // DEX configuration with full token info
      dex: config.dex
        ? {
            enabled: config.dex.enabled || false,
            factory: config.dex.factory || '',
            router: config.dex.router || '',
            masterChef: config.dex.masterChef || '',
            wrappedNative: config.dex.wrappedNative ? {
              ...config.dex.wrappedNative,
              icon: getIconConfig(wrappedSymbol).icon || null,
              color: getIconConfig(wrappedSymbol).color || 'from-gray-500 to-gray-600',
            } : null,
            rewardToken: config.dex.rewardToken ? {
              ...config.dex.rewardToken,
              icon: rewardSymbol ? getIconConfig(rewardSymbol).icon || null : null,
              color: rewardSymbol ? getIconConfig(rewardSymbol).color || 'from-gray-500 to-gray-600' : 'from-gray-500 to-gray-600',
            } : null,
            // Additional token definitions with icons from tokenIcons
            tokens: Object.fromEntries(
              Object.entries(config.dex.tokens || {}).map(([key, token]) => {
                const t = token as unknown as { symbol?: string; [key: string]: unknown };
                const sym = t.symbol || '';
                return [key, {
                  ...t,
                  icon: getIconConfig(sym).icon || null,
                  color: getIconConfig(sym).color || 'from-gray-500 to-gray-600',
                }];
              })
            ),
            // LP token addresses
            lpTokens: config.dex.lpTokens || {},
            // Farm pool configurations
            farmPools: config.dex.farmPools || [],
          }
        : null,
      // Launchpad configuration
      launchpad: config.launchpad
        ? {
            enabled: config.launchpad.enabled || false,
            factoryAddress: config.launchpad.factoryAddress || '',
            factoryAddressV2: config.launchpad.factoryAddressV2 || '',
            useV2: config.launchpad.useV2 ?? true,
            creationFee: config.launchpad.creationFee || '0',
          }
        : null,
      // Blacklist configuration (tokens and LP pairs to hide)
      blacklist: {
        tokens: (
          (config as { blacklist?: { tokens?: { address: string }[] } }).blacklist?.tokens || []
        ).map((t) => t.address.toLowerCase()),
        lpPairs: (
          (config as { blacklist?: { lpPairs?: { address: string }[] } }).blacklist?.lpPairs || []
        ).map((p) => p.address.toLowerCase()),
      },
      // Social links
      social: config.social || null,
    });
  } catch (error) {
    console.error('Error loading config for client:', error);
    // Ethereum-compatible defaults on error
    return NextResponse.json(
      {
        currency: {
          name: 'Ethereum',
          symbol: 'ETH',
          unit: 'wei',
          decimals: 18,
          gasUnit: 'Gwei',
        },
        explorer: {
          name: 'Blockchain Explorer',
          description: 'Real-time blockchain explorer',
        },
        miners: {},
        network: null,
        dex: null,
        launchpad: null,
        blacklist: { tokens: [], lpPairs: [] },
        social: null,
      },
      { status: 500 }
    );
  }
}
