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

/**
 * Initialize currency config from API (call once on app load)
 */
export async function initializeCurrencyConfig(): Promise<void> {
  if (currencyCache) return;
  
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
    }
  } catch {
    // Use defaults if API fails
    currencyCache = {
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
      gasUnit: 'Gwei',
    };
  }
}

/**
 * Get currency symbol (client-safe)
 * Returns cached value or default
 */
export function getCurrencySymbol(): string {
  return currencyCache?.symbol || 'VBC';
}

/**
 * Get currency name (client-safe)
 * Returns cached value or default
 */
export function getCurrencyName(): string {
  return currencyCache?.name || 'VirBiCoin';
}

/**
 * Get currency config (client-safe)
 * Returns cached value or defaults
 */
export function getCurrencyConfig() {
  return currencyCache || {
    symbol: 'VBC',
    name: 'VirBiCoin',
    decimals: 18,
    gasUnit: 'Gwei',
  };
}

/**
 * Get gas unit (client-safe)
 */
export function getGasUnit(): string {
  return currencyCache?.gasUnit || 'Gwei';
}
