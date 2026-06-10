/**
 * Format Utilities
 *
 * Common formatting functions for displaying blockchain data.
 */

import { formatUnits } from 'ethers';

/**
 * Format token balance with proper decimals
 */
export function formatTokenBalance(rawBalance: string | bigint, decimals: number = 18): string {
  try {
    const balance = BigInt(rawBalance);
    return formatUnits(balance, decimals);
  } catch {
    return '0';
  }
}

/**
 * Format large numbers with commas
 */
export function formatNumber(num: number | string): string {
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 18 });
}

/**
 * Format wei to ether with proper precision
 */
export function formatEther(wei: string | bigint): string {
  try {
    return formatUnits(BigInt(wei), 18);
  } catch {
    return '0';
  }
}

/**
 * Shorten address for display (0x1234...5678)
 */
export function shortenAddress(address: string, chars: number = 4): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Format relative time (e.g., "5 minutes ago")
 */
export function timeAgo(timestamp: number | Date): string {
  const now = Date.now();
  const time = typeof timestamp === 'number' ? timestamp * 1000 : timestamp.getTime();
  const diff = now - time;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

/**
 * Format percentage
 */
export function formatPercentage(value: number | string, decimals: number = 2): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(n)) return '0%';
  return `${n.toFixed(decimals)}%`;
}

/**
 * Format hash rate
 */
export function formatHashrate(hashrate: string | number): string {
  const h = typeof hashrate === 'string' ? parseFloat(hashrate) : hashrate;
  if (isNaN(h) || h === 0) return '0 H/s';

  const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s'];
  let unitIndex = 0;
  let value = h;

  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex++;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format difficulty
 */
export function formatDifficulty(difficulty: string | number): string {
  const d = typeof difficulty === 'string' ? parseFloat(difficulty) : difficulty;
  if (isNaN(d) || d === 0) return '0';

  const units = ['', 'K', 'M', 'G', 'T', 'P', 'E'];
  let unitIndex = 0;
  let value = d;

  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex++;
  }

  return `${value.toFixed(2)}${units[unitIndex]}`;
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

/**
 * Normalize address to lowercase with 0x prefix
 */
export function normalizeAddress(address: string): string {
  if (!address) return '';
  const cleaned = address.toLowerCase().trim();
  if (!cleaned.startsWith('0x')) {
    return `0x${cleaned}`;
  }
  return cleaned;
}

/**
 * Check if string is valid hex
 */
export function isValidHex(str: string): boolean {
  if (!str.startsWith('0x')) return false;
  return /^0x[0-9a-fA-F]*$/.test(str);
}

/**
 * Legacy explorer hosts that have been migrated to the current domain.
 * On-chain token logoUrl() values may still point at the old
 * explorer.digitalregion.jp host, which now returns HTTP 502 while the new
 * domain serves the same image paths.
 */
const LEGACY_EXPLORER_HOSTS: readonly string[] = ['explorer.digitalregion.jp'];

/**
 * Rewrite logo URLs that point at a legacy explorer host to the current
 * explorer host so images keep resolving after a domain migration.
 *
 * Returns null for empty/invalid input and leaves non-legacy or non-URL
 * values untouched.
 */
export function normalizeLegacyLogoUrl(
  url: string | null | undefined,
  currentExplorerHost: string,
  legacyHosts: readonly string[] = LEGACY_EXPLORER_HOSTS
): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (legacyHosts.includes(parsed.hostname)) {
      parsed.hostname = currentExplorerHost;
      return parsed.toString();
    }
    return trimmed;
  } catch {
    // Not a parsable absolute URL (e.g. a relative path); return as-is.
    return trimmed;
  }
}

/**
 * Check if address is valid Ethereum address
 */
export function isValidAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/i.test(address);
}

/**
 * Check if hash is valid transaction/block hash
 */
export function isValidHash(hash: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/i.test(hash);
}
