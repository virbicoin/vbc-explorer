/**
 * Supply API Library for VirBiCoin
 * 
 * Provides Total Supply and Circulating Supply calculations
 * for CoinGecko and CoinMarketCap integration.
 * 
 * Calculation Logic:
 * - Total Supply = (Block Height × Block Reward) + Pre-mine Amount
 * - Circulating Supply = Total Supply - (Sum of Excluded Wallet Balances)
 */

import { createPublicClient, http, formatEther, type Address } from 'viem';
import configJson from '../config.json';

// ============================================
// Configuration
// ============================================

interface ExcludedAddress {
  address: string;
  label: string;
}

interface SupplyConfig {
  blockReward: number;
  premineAmount: number;
  excludedAddresses: ExcludedAddress[];
  cacheDuration: number;
}

// Type assertion for config with optional supply property
interface ConfigWithSupply {
  supply?: {
    blockReward?: number;
    premineAmount?: number;
    excludedAddresses?: ExcludedAddress[];
    cacheDuration?: number;
  };
  network?: {
    rpcUrl?: string;
  };
  web3Provider?: {
    url?: string;
  };
}

const config = configJson as ConfigWithSupply;

// Load configuration from config.json with defaults
const supplyConfig: SupplyConfig = {
  blockReward: config.supply?.blockReward ?? 8,
  premineAmount: config.supply?.premineAmount ?? 330000000,
  excludedAddresses: config.supply?.excludedAddresses ?? [],
  cacheDuration: config.supply?.cacheDuration ?? 60,
};

// RPC URL from config
const RPC_URL = config.network?.rpcUrl || config.web3Provider?.url || 'http://localhost:8329';

// ============================================
// Viem Client Setup
// ============================================

const publicClient = createPublicClient({
  transport: http(RPC_URL, {
    timeout: 30000,
    retryCount: 3,
    retryDelay: 1000,
  }),
});

// ============================================
// Cache Management
// ============================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface SupplyCache {
  blockNumber: CacheEntry<bigint> | null;
  totalSupply: CacheEntry<number> | null;
  circulatingSupply: CacheEntry<number> | null;
  excludedBalances: CacheEntry<Map<string, bigint>> | null;
}

const cache: SupplyCache = {
  blockNumber: null,
  totalSupply: null,
  circulatingSupply: null,
  excludedBalances: null,
};

function isCacheValid<T>(entry: CacheEntry<T> | null): boolean {
  if (!entry) return false;
  const now = Date.now();
  const cacheDurationMs = supplyConfig.cacheDuration * 1000;
  return (now - entry.timestamp) < cacheDurationMs;
}

// ============================================
// Core Functions
// ============================================

/**
 * Get current block number from the blockchain
 */
export async function getBlockNumber(): Promise<bigint> {
  // Check cache first
  if (isCacheValid(cache.blockNumber)) {
    return cache.blockNumber!.data;
  }

  try {
    const blockNumber = await publicClient.getBlockNumber();
    
    // Update cache
    cache.blockNumber = {
      data: blockNumber,
      timestamp: Date.now(),
    };
    
    return blockNumber;
  } catch (error) {
    console.error('[Supply] Error fetching block number:', error);
    
    // Return cached value if available, even if expired
    if (cache.blockNumber) {
      console.warn('[Supply] Using expired cache for block number');
      return cache.blockNumber.data;
    }
    
    throw new Error('Failed to fetch block number');
  }
}

/**
 * Get balance of an address
 */
export async function getAddressBalance(address: string): Promise<bigint> {
  try {
    const balance = await publicClient.getBalance({
      address: address as Address,
    });
    return balance;
  } catch (error) {
    console.error(`[Supply] Error fetching balance for ${address}:`, error);
    return 0n;
  }
}

/**
 * Get balances of all excluded addresses
 */
export async function getExcludedBalances(): Promise<Map<string, bigint>> {
  // Check cache first
  if (isCacheValid(cache.excludedBalances)) {
    return cache.excludedBalances!.data;
  }

  const balances = new Map<string, bigint>();
  
  // Fetch all balances in parallel
  const promises = supplyConfig.excludedAddresses.map(async ({ address, label }) => {
    const balance = await getAddressBalance(address);
    return { address, label, balance };
  });
  
  const results = await Promise.all(promises);
  
  for (const { address, balance } of results) {
    balances.set(address.toLowerCase(), balance);
  }
  
  // Update cache
  cache.excludedBalances = {
    data: balances,
    timestamp: Date.now(),
  };
  
  return balances;
}

/**
 * Calculate Total Supply
 * Formula: (Block Height × Block Reward) + Pre-mine Amount
 */
export async function calculateTotalSupply(): Promise<number> {
  // Check cache first
  if (isCacheValid(cache.totalSupply)) {
    return cache.totalSupply!.data;
  }

  const blockNumber = await getBlockNumber();
  const blockReward = supplyConfig.blockReward;
  const premineAmount = supplyConfig.premineAmount;
  
  // Calculate: (blockNumber * blockReward) + premineAmount
  const totalSupply = (Number(blockNumber) * blockReward) + premineAmount;
  
  // Update cache
  cache.totalSupply = {
    data: totalSupply,
    timestamp: Date.now(),
  };
  
  return totalSupply;
}

/**
 * Calculate Circulating Supply
 * Formula: Total Supply - (Sum of Excluded Wallet Balances)
 */
export async function calculateCirculatingSupply(): Promise<number> {
  // Check cache first
  if (isCacheValid(cache.circulatingSupply)) {
    return cache.circulatingSupply!.data;
  }

  // Get total supply and excluded balances in parallel
  const [totalSupply, excludedBalances] = await Promise.all([
    calculateTotalSupply(),
    getExcludedBalances(),
  ]);
  
  // Sum up all excluded balances
  let totalExcluded = 0n;
  for (const balance of excludedBalances.values()) {
    totalExcluded += balance;
  }
  
  // Convert excluded balance from wei to VBC (divide by 10^18)
  const excludedInVBC = Number(formatEther(totalExcluded));
  
  // Calculate circulating supply
  const circulatingSupply = totalSupply - excludedInVBC;
  
  // Update cache
  cache.circulatingSupply = {
    data: circulatingSupply,
    timestamp: Date.now(),
  };
  
  return Math.max(0, circulatingSupply); // Ensure non-negative
}

/**
 * Get detailed supply information (for debugging/admin)
 */
export async function getSupplyDetails(): Promise<{
  blockNumber: string;
  blockReward: number;
  premineAmount: number;
  totalSupply: number;
  circulatingSupply: number;
  excludedAddresses: Array<{
    address: string;
    label: string;
    balance: string;
  }>;
  cacheStatus: {
    blockNumberCached: boolean;
    totalSupplyCached: boolean;
    circulatingSupplyCached: boolean;
  };
}> {
  const blockNumber = await getBlockNumber();
  const totalSupply = await calculateTotalSupply();
  const circulatingSupply = await calculateCirculatingSupply();
  const excludedBalances = await getExcludedBalances();
  
  const excludedAddressDetails = supplyConfig.excludedAddresses.map(({ address, label }) => ({
    address,
    label,
    balance: formatEther(excludedBalances.get(address.toLowerCase()) || 0n),
  }));
  
  return {
    blockNumber: blockNumber.toString(),
    blockReward: supplyConfig.blockReward,
    premineAmount: supplyConfig.premineAmount,
    totalSupply,
    circulatingSupply,
    excludedAddresses: excludedAddressDetails,
    cacheStatus: {
      blockNumberCached: isCacheValid(cache.blockNumber),
      totalSupplyCached: isCacheValid(cache.totalSupply),
      circulatingSupplyCached: isCacheValid(cache.circulatingSupply),
    },
  };
}

/**
 * Clear all cached data (useful for forcing refresh)
 */
export function clearSupplyCache(): void {
  cache.blockNumber = null;
  cache.totalSupply = null;
  cache.circulatingSupply = null;
  cache.excludedBalances = null;
  console.log('[Supply] Cache cleared');
}

// Export configuration for reference
export const SUPPLY_CONFIG = {
  rpcUrl: RPC_URL,
  blockReward: supplyConfig.blockReward,
  premineAmount: supplyConfig.premineAmount,
  excludedAddresses: supplyConfig.excludedAddresses,
  cacheDuration: supplyConfig.cacheDuration,
};
