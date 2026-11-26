/**
 * Shared singletons for the Blockscout/Etherscan-compatible API (`app/api/route.ts`).
 *
 * Centralizes the config, the viem RPC client and the response envelope helpers
 * so they can be reused by the extracted module handlers (e.g. the JSON-RPC
 * proxy) without duplicating instances.
 */

import { NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { loadConfig } from '@/lib/config';
import { getSecurityHeaders } from '@/lib/security';
import { Block, Token } from '@/models/index';

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

// Token model (collection `tokens`) shared by the blockscout handlers.
export { Token };

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

/** Etherscan's answer for a list without rows: status 0 with an empty array. */
export function emptyListResponse(message = 'No transactions found') {
  return errorResponse(message, []);
}

/**
 * Envelope of the `proxy` module and of Blockscout's `eth_*` actions: JSON-RPC,
 * as Etherscan returns it (clients such as ethers' EtherscanProvider check
 * `jsonrpc`). `status` / `message` stay for clients written against the
 * earlier `{ status, message, result }` shape of this explorer.
 */
export function rpcResponse(result: unknown) {
  return NextResponse.json(
    { jsonrpc: '2.0', id: 1, result, status: '1', message: 'OK' },
    { headers: getSecurityHeaders() }
  );
}

/** JSON-RPC error in the same envelope (the node's message, never a stack). */
export function rpcErrorResponse(message: string) {
  return NextResponse.json(
    { jsonrpc: '2.0', id: 1, error: { code: -32000, message }, status: '0', message, result: null },
    { headers: getSecurityHeaders() }
  );
}

/**
 * `isError` / `txreceipt_status` from the stored receipt status: 1 success,
 * 0 failed, null when the transaction was saved without a receipt (then the
 * receipt status is unknown and reported empty, as Etherscan does for
 * pre-Byzantium transactions).
 */
export function txStatusFields(status: unknown): { isError: string; txreceipt_status: string } {
  const failed = status === 0 || status === false;
  const known = status === 0 || status === 1 || typeof status === 'boolean';
  return { isError: failed ? '1' : '0', txreceipt_status: known ? (failed ? '0' : '1') : '' };
}

/** First four bytes of the call data, `0x` for a plain transfer. */
export function methodId(input: unknown): string {
  return typeof input === 'string' && input.length >= 10 ? input.slice(0, 10).toLowerCase() : '0x';
}

/** Height of the newest stored block (for `confirmations`); 0 for an empty collection. */
export async function getHeadNumber(): Promise<number> {
  const head = (await Block.findOne().sort({ number: -1 }).select('number').lean()) as {
    number?: number;
  } | null;
  return head?.number ?? 0;
}

/** Confirmations of a block at the given head, as a decimal string. */
export function confirmations(head: number, blockNumber: unknown): string {
  const height = Number(blockNumber);
  return Number.isFinite(height) && head >= height ? String(head - height + 1) : '0';
}

// ============================================
// Block Reward Schedule
// ============================================

// The schedule comes from config.json `rewards`; the functions live in lib/reward-schedule.ts.
