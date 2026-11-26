/**
 * Supply API Library for VirBiCoin
 *
 * Provides Total Supply and Circulating Supply calculations
 * for CoinGecko and CoinMarketCap integration.
 *
 * Calculation Logic:
 * - Total Supply = Pre-mine Amount
 *                  + block rewards of blocks 1..head (lib/reward-schedule.ts)
 *                  + uncle issuance (uncle + nephew rewards, summed from Block.uncleReward)
 * - Circulating Supply = Total Supply - (Sum of Excluded Wallet Balances)
 *
 * Block and uncle rewards are the only ways new coins are created. Uncle
 * issuance is read from the database: blocks synced before the field existed
 * are filled by `npm run backfill-uncle-rewards`, whose progress
 * getSupplyDetails() reports.
 */

import { createPublicClient, http, formatEther, parseEther, type Address } from 'viem';
import { loadConfig } from './config';
import { calculateTotalMiningReward, getBlockRewardForHeight } from './reward-schedule';
import { connectDB, Block, ScanProgress } from '../models/index';
import { UNCLE_REWARD_SCAN } from './sync/uncle-rewards';

// ============================================
// Configuration
// ============================================

interface ExcludedAddress {
  address: string;
  label: string;
}

interface SupplyConfig {
  premineAmount: number;
  excludedAddresses: ExcludedAddress[];
  cacheDuration: number;
}

// Type assertion for config with optional supply property
interface ConfigWithSupply {
  supply?: {
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

const config = loadConfig() as ConfigWithSupply;

// Load configuration from config.json with defaults
const supplyConfig: SupplyConfig = {
  // No premine unless config.json states one (VirBiCoin: 1 VBC in the genesis block)
  premineAmount: config.supply?.premineAmount ?? 0,
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
  uncleIssuance: CacheEntry<bigint> | null;
  totalSupply: CacheEntry<number> | null;
  circulatingSupply: CacheEntry<number> | null;
  excludedBalances: CacheEntry<Map<string, bigint>> | null;
}

const cache: SupplyCache = {
  blockNumber: null,
  uncleIssuance: null,
  totalSupply: null,
  circulatingSupply: null,
  excludedBalances: null,
};

function isCacheValid<T>(entry: CacheEntry<T> | null): boolean {
  if (!entry) return false;
  const now = Date.now();
  const cacheDurationMs = supplyConfig.cacheDuration * 1000;
  return now - entry.timestamp < cacheDurationMs;
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
 * Wei created for uncles across all stored blocks (sum of Block.uncleReward).
 * Falls back to the last value when the database is unavailable.
 */
export async function getUncleIssuanceWei(): Promise<bigint> {
  if (isCacheValid(cache.uncleIssuance)) {
    return cache.uncleIssuance!.data;
  }

  try {
    await connectDB();
    const [row] = await Block.aggregate<{ total: { toString(): string } }>([
      { $match: { uncleReward: { $exists: true } } },
      { $group: { _id: null, total: { $sum: { $toDecimal: '$uncleReward' } } } },
    ]);
    const total = row ? BigInt(row.total.toString()) : 0n;
    cache.uncleIssuance = { data: total, timestamp: Date.now() };
    return total;
  } catch (error) {
    console.error('[Supply] Error summing uncle rewards:', error);
    if (cache.uncleIssuance) {
      console.warn('[Supply] Using expired cache for uncle issuance');
      return cache.uncleIssuance.data;
    }
    throw new Error('Failed to sum uncle rewards', { cause: error });
  }
}

/**
 * Calculate Total Supply
 * Pre-mine + scheduled block rewards (8 -> 7 -> ... -> 1 VBC, every 2,100,000
 * blocks from 4,200,000) + uncle issuance.
 */
/** Pre-mine + scheduled block rewards of blocks 1..blockNumber + uncle issuance, in wei. */
export function computeTotalSupplyWei(
  blockNumber: number,
  premineAmount: number,
  uncleIssuanceWei: bigint
): bigint {
  return (
    parseEther(String(premineAmount)) +
    BigInt(calculateTotalMiningReward(blockNumber)) * 10n ** 18n +
    uncleIssuanceWei
  );
}

export async function calculateTotalSupplyWei(): Promise<bigint> {
  const [blockNumber, uncleIssuance] = await Promise.all([getBlockNumber(), getUncleIssuanceWei()]);
  return computeTotalSupplyWei(Number(blockNumber), supplyConfig.premineAmount, uncleIssuance);
}

export async function calculateTotalSupply(): Promise<number> {
  // Check cache first
  if (isCacheValid(cache.totalSupply)) {
    return cache.totalSupply!.data;
  }

  const totalSupply = Number(formatEther(await calculateTotalSupplyWei()));

  // Update cache
  cache.totalSupply = {
    data: totalSupply,
    timestamp: Date.now(),
  };

  return totalSupply;
}

/** Circulating supply in wei: total supply minus the excluded wallet balances. */
export async function calculateCirculatingSupplyWei(): Promise<bigint> {
  const [totalSupply, excludedBalances] = await Promise.all([
    calculateTotalSupplyWei(),
    getExcludedBalances(),
  ]);
  let totalExcluded = 0n;
  for (const balance of excludedBalances.values()) {
    totalExcluded += balance;
  }
  const circulating = totalSupply - totalExcluded;
  return circulating > 0n ? circulating : 0n;
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
  blockRewards: number;
  uncleRewards: string;
  uncleRewardsBackfill: { lastScannedBlock: number; lastUpdateTime: Date | null } | null;
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
  const uncleIssuance = await getUncleIssuanceWei();
  const backfill = (await ScanProgress.findOne({ scanType: UNCLE_REWARD_SCAN }).lean()) as {
    lastScannedBlock?: number;
    lastUpdateTime?: Date;
  } | null;

  const excludedAddressDetails = supplyConfig.excludedAddresses.map(({ address, label }) => ({
    address,
    label,
    balance: formatEther(excludedBalances.get(address.toLowerCase()) || 0n),
  }));

  return {
    blockNumber: blockNumber.toString(),
    blockReward: getBlockRewardForHeight(Number(blockNumber)),
    premineAmount: supplyConfig.premineAmount,
    blockRewards: calculateTotalMiningReward(Number(blockNumber)),
    uncleRewards: formatEther(uncleIssuance),
    // null until `npm run backfill-uncle-rewards` has run: blocks synced before then are not counted
    uncleRewardsBackfill: backfill
      ? {
          lastScannedBlock: backfill.lastScannedBlock ?? 0,
          lastUpdateTime: backfill.lastUpdateTime ?? null,
        }
      : null,
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
  cache.uncleIssuance = null;
  cache.totalSupply = null;
  cache.circulatingSupply = null;
  cache.excludedBalances = null;
  console.log('[Supply] Cache cleared');
}

// Export configuration for reference
export const SUPPLY_CONFIG = {
  rpcUrl: RPC_URL,
  premineAmount: supplyConfig.premineAmount,
  excludedAddresses: supplyConfig.excludedAddresses,
  cacheDuration: supplyConfig.cacheDuration,
};
