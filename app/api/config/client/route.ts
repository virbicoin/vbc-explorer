import { NextResponse } from 'next/server';
import { loadConfig } from '../../../../lib/config';

// Type for tokenIcons config
interface TokenIconEntry {
  icon?: string;
  color?: string;
}

// Type for bridge config (native chain <-> remote chain via lock/mint)
interface BridgeRemote {
  chainId: number;
  name: string;
  nativeSymbol: string;
  rpcUrl: string;
  explorer: string;
  bridge: string;
  wrappedToken: string;
  wrappedSymbol: string;
  dexName?: string;
  swapUrl?: string;
  // Optional in-page swap (V2 router) converting the wrapped token on the remote chain.
  swap?: {
    router: string;
    wrappedNative: string;
    outputs: { symbol: string; kind?: string; address?: string; decimals?: number }[];
  };
}
interface BridgeRoute {
  id?: string;
  label?: string;
  asset?: { kind?: string; symbol?: string; token?: string; decimals?: number };
  vault?: string;
  remote?: BridgeRemote;
  // Optional single-tx auto-conversion entry contract on this chain.
  autoSwap?: { lockAndSwap?: string };
}
interface BridgeCfg {
  enabled?: boolean;
  relayEtaSeconds?: number;
  // Multi-route shape (preferred); legacy single vault/remote is still supported.
  routes?: BridgeRoute[];
  vault?: string;
  remote?: BridgeRemote;
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
        url: config.explorer?.url || '',
        // Decommissioned explorer domains; clients rewrite legacy logo URLs to the current host
        legacyUrls: config.explorer?.legacyUrls || [],
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
            wrappedNative: config.dex.wrappedNative
              ? {
                  ...config.dex.wrappedNative,
                  icon: getIconConfig(wrappedSymbol).icon || null,
                  color: getIconConfig(wrappedSymbol).color || 'from-gray-500 to-gray-600',
                }
              : null,
            rewardToken: config.dex.rewardToken
              ? {
                  ...config.dex.rewardToken,
                  icon: rewardSymbol ? getIconConfig(rewardSymbol).icon || null : null,
                  color: rewardSymbol
                    ? getIconConfig(rewardSymbol).color || 'from-gray-500 to-gray-600'
                    : 'from-gray-500 to-gray-600',
                }
              : null,
            // Additional token definitions with icons from tokenIcons
            tokens: Object.fromEntries(
              Object.entries(config.dex.tokens || {}).map(([key, token]) => {
                const t = token as unknown as { symbol?: string; [key: string]: unknown };
                const sym = t.symbol || '';
                return [
                  key,
                  {
                    ...t,
                    icon: getIconConfig(sym).icon || null,
                    color: getIconConfig(sym).color || 'from-gray-500 to-gray-600',
                  },
                ];
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
            legacyFactories: config.launchpad.legacyFactories || [],
            creationFee: config.launchpad.creationFee || '0',
            alternativePayment: config.launchpad.alternativePayment
              ? {
                  enabled: config.launchpad.alternativePayment.enabled || false,
                  token: config.launchpad.alternativePayment.token || null,
                  fee: config.launchpad.alternativePayment.fee || '0',
                  discountLabel: config.launchpad.alternativePayment.discountLabel || '',
                  burnNote: config.launchpad.alternativePayment.burnNote || '',
                  contractFunctions: config.launchpad.alternativePayment.contractFunctions || {
                    getFeeInfo: 'getAlternativeFeeInfo',
                    createToken: 'createTokenWithAlternative',
                    createTokenWithMetadata: 'createTokenWithAlternativeAndMetadata',
                  },
                }
              : null,
          }
        : null,
      // Bridge configuration. Prefers the multi-route `routes[]` shape; the
      // legacy single vault/remote is still passed through for back-compat.
      bridge: (config as { bridge?: BridgeCfg }).bridge
        ? {
            enabled: (config as { bridge?: BridgeCfg }).bridge!.enabled ?? false,
            relayEtaSeconds: (config as { bridge?: BridgeCfg }).bridge!.relayEtaSeconds ?? 90,
            routes: (config as { bridge?: BridgeCfg }).bridge!.routes ?? null,
            vault: (config as { bridge?: BridgeCfg }).bridge!.vault ?? '',
            remote: (config as { bridge?: BridgeCfg }).bridge!.remote ?? null,
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
        launchpadTokens: (
          (config as { blacklist?: { launchpadTokens?: { address: string }[] } }).blacklist
            ?.launchpadTokens || []
        ).map((t) => t.address.toLowerCase()),
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
        bridge: null,
        blacklist: { tokens: [], lpPairs: [] },
        social: null,
      },
      { status: 500 }
    );
  }
}
