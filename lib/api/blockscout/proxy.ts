/**
 * JSON-RPC proxy handlers for the Blockscout/Etherscan-compatible API.
 *
 * Each function validates the parameters of an Etherscan `proxy` action and
 * forwards the call to the node. The node's result is returned unchanged in
 * the JSON-RPC envelope, as Etherscan does. Extracted from `app/api/route.ts`
 * to keep that dispatcher thin.
 *
 * `eth_sendRawTransaction` is not offered here: transactions are broadcast
 * through the public RPC endpoint.
 */

import { isValidAddress, isValidHash } from '@/lib/security';
import { publicClient, errorResponse, rpcResponse, rpcErrorResponse } from './shared';

const BLOCK_TAGS = new Set(['latest', 'earliest', 'pending', 'safe', 'finalized']);

/**
 * Hex quantity for a decimal or hex number (leading zeros removed, which the
 * node rejects); null when the value is not a number.
 */
export function toQuantity(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (!/^\d+$/.test(text) && !/^0x[0-9a-fA-F]+$/.test(text)) return null;
  return `0x${BigInt(text).toString(16)}`;
}

/** Block parameter: a tag, or a height as a hex quantity; `latest` when absent; null when malformed. */
export function toBlockParameter(tag: string | null | undefined): string | null {
  if (tag === null || tag === undefined || tag.trim() === '') return 'latest';
  const text = tag.trim().toLowerCase();
  return BLOCK_TAGS.has(text) ? text : toQuantity(text);
}

function isHexData(value: string): boolean {
  return /^0x([0-9a-fA-F]{2})*$/.test(value);
}

async function forward(method: string, params: unknown[]) {
  try {
    const result = await publicClient.request({ method, params } as never);
    return rpcResponse(result ?? null);
  } catch (error) {
    // the node's own message (for example "execution reverted"), never the request details
    const details = (error as { details?: unknown }).details;
    return rpcErrorResponse(
      typeof details === 'string' && details ? details : 'Node request failed'
    );
  }
}

export async function proxyEthBlockNumber() {
  return forward('eth_blockNumber', []);
}

export async function proxyEthGetBlockByNumber(tag: string | null, full = false) {
  const block = toBlockParameter(tag);
  if (!block) return errorResponse('Invalid tag parameter');
  return forward('eth_getBlockByNumber', [block, full]);
}

export async function proxyEthGetUncleByBlockNumberAndIndex(
  tag: string | null,
  index: string | null
) {
  const block = toBlockParameter(tag);
  const position = toQuantity(index);
  if (!block) return errorResponse('Invalid tag parameter');
  if (!position) return errorResponse('Invalid index parameter');
  return forward('eth_getUncleByBlockNumberAndIndex', [block, position]);
}

export async function proxyEthGetBlockTransactionCountByNumber(tag: string | null) {
  const block = toBlockParameter(tag);
  if (!block) return errorResponse('Invalid tag parameter');
  return forward('eth_getBlockTransactionCountByNumber', [block]);
}

export async function proxyEthGetTransactionByHash(txhash: string) {
  if (!isValidHash(txhash)) return errorResponse('Invalid txhash format');
  return forward('eth_getTransactionByHash', [txhash.toLowerCase()]);
}

export async function proxyEthGetTransactionByBlockNumberAndIndex(
  tag: string | null,
  index: string | null
) {
  const block = toBlockParameter(tag);
  const position = toQuantity(index);
  if (!block) return errorResponse('Invalid tag parameter');
  if (!position) return errorResponse('Invalid index parameter');
  return forward('eth_getTransactionByBlockNumberAndIndex', [block, position]);
}

export async function proxyEthGetTransactionCount(address: string, tag: string | null) {
  const block = toBlockParameter(tag);
  if (!isValidAddress(address)) return errorResponse('Invalid address format');
  if (!block) return errorResponse('Invalid tag parameter');
  return forward('eth_getTransactionCount', [address.toLowerCase(), block]);
}

export async function proxyEthGetTransactionReceipt(txhash: string) {
  if (!isValidHash(txhash)) return errorResponse('Invalid txhash format');
  return forward('eth_getTransactionReceipt', [txhash.toLowerCase()]);
}

export async function proxyEthCall(to: string, data: string, tag: string | null = 'latest') {
  const block = toBlockParameter(tag);
  if (!isValidAddress(to)) return errorResponse('Invalid to parameter');
  if (!isHexData(data)) return errorResponse('Invalid data parameter');
  if (!block) return errorResponse('Invalid tag parameter');
  return forward('eth_call', [{ to: to.toLowerCase(), data }, block]);
}

export async function proxyEthGetCode(address: string, tag: string | null = 'latest') {
  const block = toBlockParameter(tag);
  if (!isValidAddress(address)) return errorResponse('Invalid address format');
  if (!block) return errorResponse('Invalid tag parameter');
  return forward('eth_getCode', [address.toLowerCase(), block]);
}

export async function proxyEthGetStorageAt(
  address: string,
  position: string | null,
  tag: string | null
) {
  const block = toBlockParameter(tag);
  const slot = toQuantity(position);
  if (!isValidAddress(address)) return errorResponse('Invalid address format');
  if (!slot) return errorResponse('Invalid position parameter');
  if (!block) return errorResponse('Invalid tag parameter');
  return forward('eth_getStorageAt', [address.toLowerCase(), slot, block]);
}

export async function proxyEthGasPrice() {
  return forward('eth_gasPrice', []);
}

export async function proxyEthEstimateGas(
  to: string,
  data?: string,
  value?: string,
  from?: string,
  gas?: string,
  gasPrice?: string
) {
  if (!isValidAddress(to)) return errorResponse('Invalid to parameter');
  if (from !== undefined && !isValidAddress(from)) return errorResponse('Invalid from parameter');
  if (data !== undefined && !isHexData(data)) return errorResponse('Invalid data parameter');
  const call: Record<string, string> = { to: to.toLowerCase() };
  if (from) call.from = from.toLowerCase();
  if (data) call.data = data;
  for (const [name, amount] of Object.entries({ value, gas, gasPrice })) {
    if (amount === undefined) continue;
    const quantity = toQuantity(amount);
    if (!quantity) return errorResponse(`Invalid ${name} parameter`);
    call[name] = quantity;
  }
  return forward('eth_estimateGas', [call]);
}
