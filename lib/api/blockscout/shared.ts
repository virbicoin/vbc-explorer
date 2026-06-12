/**
 * Shared singletons for the Blockscout/Etherscan-compatible API (`app/api/route.ts`).
 *
 * Centralizes the config, the viem RPC client and the response envelope helpers
 * so they can be reused by the extracted module handlers (e.g. the JSON-RPC
 * proxy) without duplicating instances.
 */

import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { createPublicClient, http } from 'viem';
import { loadConfig } from '@/lib/config';
import { getSecurityHeaders } from '@/lib/security';

/** Config shape with the supply section used by the stats/block handlers. */
export interface ConfigWithSupply {
  network?: { rpcUrl?: string };
  web3Provider?: { url?: string };
  supply?: {
    blockReward?: number;
    premineAmount?: number;
    excludedAddresses?: Array<{ address: string; label: string }>;
    cacheDuration?: number;
  };
  [key: string]: unknown;
}

export const configJson = loadConfig() as ConfigWithSupply;

// Token schema defined here since it's not exported from models/index.
const tokenSchema = new mongoose.Schema(
  {
    address: String,
    name: String,
    symbol: String,
    decimals: { type: Number, default: 18 },
    totalSupply: String,
    holders: { type: Number, default: 0 },
    type: String,
    supply: String,
    verified: { type: Boolean, default: false },
    logoUrl: { type: String, default: null },
  },
  { collection: 'tokens' }
);

export const Token = mongoose.models.Token || mongoose.model('Token', tokenSchema);

// RPC Client
const RPC_URL =
  configJson.network?.rpcUrl || configJson.web3Provider?.url || 'http://localhost:8329';

export const publicClient = createPublicClient({
  transport: http(RPC_URL, { timeout: 30000 }),
});

/** Etherscan-style success envelope: `{ status: '1', message, result }`. */
export function successResponse(result: unknown, message = 'OK') {
  return NextResponse.json(
    {
      status: '1',
      message,
      result,
    },
    { headers: getSecurityHeaders() }
  );
}

/** Etherscan-style error envelope: `{ status: '0', message, result }`. */
export function errorResponse(message: string, result: unknown = null) {
  return NextResponse.json(
    {
      status: '0',
      message,
      result,
    },
    { headers: getSecurityHeaders() }
  );
}

// ============================================
// Block Reward Schedule
// ============================================

const FIRST_REDUCTION_BLOCK = 4_200_000;
const REWARD_REDUCTION_INTERVAL = 2_100_000;
const BASE_REWARD = 8;
const MIN_REWARD = 1;

/**
 * Returns the block reward in VBC for a given block number.
 * First reduction at block 4,200,000, then every 2,100,000 blocks.
 * Schedule: 8 -> 7 -> 6 -> 5 -> 4 -> 3 -> 2 -> 1 VBC
 */
export function getBlockRewardForHeight(blockNumber: number): number {
  if (blockNumber < FIRST_REDUCTION_BLOCK) return BASE_REWARD;
  const reductions =
    Math.floor((blockNumber - FIRST_REDUCTION_BLOCK) / REWARD_REDUCTION_INTERVAL) + 1;
  if (reductions >= 7) return MIN_REWARD;
  return BASE_REWARD - reductions;
}

/**
 * Returns the block reward in wei (string) for API responses.
 */
export function getBlockRewardWeiForHeight(blockNumber: number): string {
  return (BigInt(getBlockRewardForHeight(blockNumber)) * BigInt(10 ** 18)).toString();
}

/**
 * Calculates cumulative mining reward from block 0 to the given block number,
 * accounting for the gradual reward reduction schedule.
 */
export function calculateTotalMiningReward(blockNumber: number): number {
  if (blockNumber <= 0) return 0;

  let total = 0;

  // First epoch: block 0 to FIRST_REDUCTION_BLOCK (reward = 8 VBC)
  const firstEpochBlocks = Math.min(blockNumber, FIRST_REDUCTION_BLOCK);
  total += firstEpochBlocks * BASE_REWARD;

  let remaining = blockNumber - firstEpochBlocks;
  let currentReward = BASE_REWARD - 1;

  // Subsequent epochs: each REWARD_REDUCTION_INTERVAL blocks
  while (remaining > 0 && currentReward >= MIN_REWARD) {
    const blocksInEpoch = Math.min(remaining, REWARD_REDUCTION_INTERVAL);
    total += blocksInEpoch * currentReward;
    remaining -= blocksInEpoch;
    currentReward--;
  }

  if (remaining > 0) {
    total += remaining * MIN_REWARD;
  }

  return total;
}
