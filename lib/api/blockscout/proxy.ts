/**
 * Etherscan's `proxy` module: each action names a JSON-RPC method and builds its parameters from
 * the request; the node's result is returned unchanged in the JSON-RPC envelope, as Etherscan
 * does. A refused parameter throws ParamError, which the dispatcher answers with a JSON-RPC
 * "invalid params" (-32602) error.
 *
 * `eth_sendRawTransaction` is not offered here: transactions are broadcast through the public RPC
 * endpoint.
 */

import { Params, ParamError } from './params';
import { publicClient, rpcResponse, rpcErrorResponse } from './shared';

export { toQuantity, toBlockParameter } from './params';

interface RpcCall {
  method: string;
  params: unknown[];
}

/** Call object of eth_call / eth_estimateGas (only the fields that were given). */
function callObject(p: Params, withAmounts: boolean): Record<string, string> {
  const call: Record<string, string> = { to: p.address('to') };
  const from = p.optionalAddress('from');
  if (from) call.from = from;
  const data = p.optional('data');
  if (data !== undefined) call.data = p.hexData('data');
  if (withAmounts) {
    for (const name of ['value', 'gas', 'gasPrice']) {
      if (p.optional(name) !== undefined) call[name] = p.quantity(name);
    }
  }
  return call;
}

/** Etherscan proxy actions (lower case) → the JSON-RPC call they make. */
export const PROXY_ACTIONS: Record<string, (p: Params) => RpcCall> = {
  eth_blocknumber: () => ({ method: 'eth_blockNumber', params: [] }),
  eth_getblockbynumber: (p) => ({
    method: 'eth_getBlockByNumber',
    params: [p.blockTag('tag'), p.optional('boolean') === 'true'],
  }),
  eth_getunclebyblocknumberandindex: (p) => ({
    method: 'eth_getUncleByBlockNumberAndIndex',
    params: [p.blockTag('tag'), p.quantity('index')],
  }),
  eth_getblocktransactioncountbynumber: (p) => ({
    method: 'eth_getBlockTransactionCountByNumber',
    params: [p.blockTag('tag')],
  }),
  eth_gettransactionbyhash: (p) => ({
    method: 'eth_getTransactionByHash',
    params: [p.hash('txhash')],
  }),
  eth_gettransactionbyblocknumberandindex: (p) => ({
    method: 'eth_getTransactionByBlockNumberAndIndex',
    params: [p.blockTag('tag'), p.quantity('index')],
  }),
  eth_gettransactioncount: (p) => ({
    method: 'eth_getTransactionCount',
    params: [p.address('address'), p.blockTag('tag')],
  }),
  eth_gettransactionreceipt: (p) => ({
    method: 'eth_getTransactionReceipt',
    params: [p.hash('txhash')],
  }),
  eth_call: (p) => {
    if (p.optional('data') === undefined) throw new ParamError('Missing data parameter');
    return { method: 'eth_call', params: [callObject(p, false), p.blockTag('tag')] };
  },
  eth_getcode: (p) => ({
    method: 'eth_getCode',
    params: [p.address('address'), p.blockTag('tag')],
  }),
  eth_getstorageat: (p) => ({
    method: 'eth_getStorageAt',
    params: [p.address('address'), p.quantity('position'), p.blockTag('tag')],
  }),
  eth_gasprice: () => ({ method: 'eth_gasPrice', params: [] }),
  eth_estimategas: (p) => ({ method: 'eth_estimateGas', params: [callObject(p, true)] }),
};

/** Sends the call to the node and wraps the answer (or the node's error message) as JSON-RPC. */
export async function forwardRpc({ method, params }: RpcCall) {
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
