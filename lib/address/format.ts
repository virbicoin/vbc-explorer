/**
 * Shared types and pure formatting helpers for the address pages
 * (`app/address/[address]/**`).
 *
 * These were previously duplicated across the main address page and its
 * `mining` / `transactions` sub-pages. Centralizing the pure helpers removes the
 * duplication and makes them unit-testable.
 *
 * Note on `formatValue`: the main page and the sub-pages historically used two
 * slightly different implementations. Both are preserved verbatim here as
 * `formatNativeValueShort` (main page) and `formatNativeValueDetailed`
 * (mining/transactions) so rendered output is unchanged.
 */

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  type: string;
  value: string;
  tokenId?: number;
  from?: string;
  to?: string;
  direction?: 'in' | 'out';
}

export interface AddressTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  valueRaw?: string;
  timestamp: number;
  blockNumber: number;
  gasUsed?: number;
  gasPrice?: string;
  status?: number | string;
  type?: string;
  action?: string;
  direction?: 'in' | 'out' | 'self';
  input?: string;
  tokenInfo?: TokenInfo;
  tokenTransfers?: TokenInfo[];
  nftInfo?: {
    tokenId: number;
    tokenAddress: string;
  };
}

/**
 * Shorten an address to `0x123456...abcdef`. Returns `'N/A'` for empty input.
 * The main address page additionally maps the zero address to `'System'`;
 * pass `mapSystem: true` to enable that behavior.
 */
export function formatAddress(address: string, mapSystem = false): string {
  if (!address) return 'N/A';
  if (mapSystem && address === '0x0000000000000000000000000000000000000000') return 'System';
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

/** Format a unix (seconds) timestamp as a locale string with timezone. */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString(undefined, { timeZoneName: 'short' });
}

/** Relative "time ago" label for a unix (seconds) timestamp. */
export function getTimeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Main address page wei→native formatter (compact tiers).
 * Mirrors the original inline implementation exactly.
 */
export function formatNativeValueShort(value: string, currencySymbol: string): string {
  try {
    const weiValue = BigInt(value);
    const nativeValue = Number(weiValue) / 1e18;
    if (nativeValue === 0) return `0 ${currencySymbol}`;
    if (nativeValue < 0.000001) return `<0.000001 ${currencySymbol}`;
    return `${nativeValue.toFixed(4)} ${currencySymbol}`;
  } catch {
    return `${value} ${currencySymbol}`;
  }
}

/**
 * Mining/transactions wei→native formatter (graduated tiers).
 * Mirrors the original inline implementation exactly.
 */
export function formatNativeValueDetailed(value: string, currencySymbol: string): string {
  try {
    const weiValue = BigInt(value);
    const nativeValue = Number(weiValue) / 1e18;
    if (nativeValue === 0) return `0 ${currencySymbol}`;
    if (nativeValue < 0.000001) return `<0.000001 ${currencySymbol}`;
    if (nativeValue < 1) return `${nativeValue.toFixed(6)} ${currencySymbol}`;
    if (nativeValue < 1000) return `${nativeValue.toFixed(4)} ${currencySymbol}`;
    return `${nativeValue.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${currencySymbol}`;
  } catch {
    return `${value} ${currencySymbol}`;
  }
}

/** Parse a date string, returning `null` for empty/invalid input. */
export function parseDate(dateString: string): Date | null {
  if (!dateString || dateString === 'Invalid Date') return null;
  const date = new Date(dateString);
  return isNaN(date.getTime()) ? null : date;
}

/** Format a token balance string with the given decimals and symbol. */
export function formatTokenBalance(balance: string, decimals: number, symbol: string): string {
  try {
    const balanceBigInt = BigInt(balance);
    const divisor = BigInt(10 ** decimals);
    const intPart = balanceBigInt / divisor;
    const fracPart = balanceBigInt % divisor;

    if (fracPart === 0n) {
      return `${intPart.toLocaleString()} ${symbol}`;
    }

    const fracStr = fracPart.toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '');
    if (fracStr) {
      return `${intPart.toLocaleString()}.${fracStr} ${symbol}`;
    }
    return `${intPart.toLocaleString()} ${symbol}`;
  } catch {
    return `${balance} ${symbol}`;
  }
}
