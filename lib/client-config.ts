/**
 * Client-side configuration utilities
 * These functions can be used in client components without fs dependencies
 */

// Cache for currency config
let currencyCache: {
  symbol: string;
  name: string;
  decimals: number;
  gasUnit: string;
} | null = null;

// Cache for network config
let networkCache: {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorer: string;
  blockTime: number;
} | null = null;

/**
 * Initialize currency config from API (call once on app load)
 */
export async function initializeCurrencyConfig(): Promise<void> {
  if (currencyCache && networkCache) return;

  try {
    const response = await fetch('/api/config/client');
    if (response.ok) {
      const config = await response.json();
      currencyCache = {
        symbol: config.currency?.symbol || 'ETH',
        name: config.currency?.name || 'Ether',
        decimals: config.currency?.decimals || 18,
        gasUnit: config.currency?.gasUnit || 'Gwei',
      };
      networkCache = {
        name: config.network?.name || 'Ethereum',
        chainId: config.network?.chainId || 1,
        rpcUrl: config.network?.rpcUrl || 'http://localhost:8545',
        explorer: config.network?.explorer || '',
        blockTime: config.network?.blockTime || 12,
      };
    }
  } catch {
    // Use defaults if API fails
    currencyCache = {
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
      gasUnit: 'Gwei',
    };
    networkCache = {
      name: 'Ethereum',
      chainId: 1,
      rpcUrl: 'http://localhost:8545',
      explorer: '',
      blockTime: 12,
    };
  }
}

/**
 * Get currency symbol (client-safe)
 * Returns cached value or default (Ethereum-compatible)
 */
export function getCurrencySymbol(): string {
  return currencyCache?.symbol || 'ETH';
}

/**
 * Get currency name (client-safe)
 * Returns cached value or default (Ethereum-compatible)
 */
export function getCurrencyName(): string {
  return currencyCache?.name || 'Ether';
}

/**
 * Get currency config (client-safe)
 * Returns cached value or defaults (Ethereum-compatible)
 */
export function getCurrencyConfig() {
  return (
    currencyCache || {
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
      gasUnit: 'Gwei',
    }
  );
}

/**
 * Get gas unit (client-safe)
 */
export function getGasUnit(): string {
  return currencyCache?.gasUnit || 'Gwei';
}

/**
 * Get network name (client-safe)
 */
export function getNetworkName(): string {
  return networkCache?.name || 'Ethereum';
}

/**
 * Get chain ID (client-safe)
 */
export function getChainId(): number {
  return networkCache?.chainId || 1;
}

/**
 * Get RPC URL (client-safe)
 */
export function getRpcUrl(): string {
  return networkCache?.rpcUrl || 'http://localhost:8545';
}

/**
 * Get explorer URL (client-safe)
 */
export function getExplorerUrl(): string {
  return networkCache?.explorer || '';
}

/**
 * Get full network config (client-safe)
 */
export function getNetworkConfig() {
  return {
    name: networkCache?.name || 'Ethereum',
    chainId: networkCache?.chainId || 1,
    rpcUrl: networkCache?.rpcUrl || 'http://localhost:8545',
    explorer: networkCache?.explorer || '',
    blockTime: networkCache?.blockTime || 12,
  };
}
