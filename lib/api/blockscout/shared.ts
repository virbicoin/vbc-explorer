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
