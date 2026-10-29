/**
 * docs/njs/rpc-filter.js — the pure classifier used by the nginx njs handler
 * on the public JSON-RPC endpoints, exercised with Node.
 */
import { describe, expect, it, vi } from 'vitest';
import rpcfilter from '../../docs/njs/rpc-filter.js';

const { classify, isForbidden, FORBIDDEN_PREFIXES, FORBIDDEN_MESSAGE, rpc } = rpcfilter;

const call = (method: string, id: number | string | null = 1, params: unknown[] = []) => ({
  jsonrpc: '2.0',
  method,
  params,
  id,
});

function parse(body: string) {
  return JSON.parse(body) as {
    jsonrpc: string;
    error: { code: number; message: string };
    id: null;
  };
}

describe('isForbidden', () => {
  it('matches the forbidden prefixes case-insensitively and nothing else', () => {
    expect(FORBIDDEN_PREFIXES).toEqual([
      'trace_',
      'parity_',
      'debug_',
      'personal_',
      'admin_',
      'miner_',
    ]);
    for (const method of [
      'trace_block',
      'trace_replayTransaction',
      'parity_netPeers',
      'debug_traceTransaction',
      'personal_unlockAccount',
      'admin_peers',
      'miner_start',
      'Trace_block',
      'PARITY_netPeers',
    ]) {
      expect(isForbidden(method), method).toBe(true);
    }
    for (const method of [
      'eth_blockNumber',
      'eth_call',
      'net_version',
      'web3_clientVersion',
      'eth_getLogs',
      'tracer',
    ]) {
      expect(isForbidden(method), method).toBe(false);
    }
  });
});

describe('classify', () => {
  it('forwards ordinary calls and batches', () => {
    expect(classify(JSON.stringify(call('eth_blockNumber')))).toBeNull();
    expect(
      classify(JSON.stringify([call('eth_blockNumber', 1), call('eth_chainId', 2)]))
    ).toBeNull();
  });

  it('answers 403 with a JSON-RPC error for forbidden methods, also inside a batch', () => {
    const single = classify(JSON.stringify(call('trace_block', 1, ['0x1'])));
    expect(single?.status).toBe(403);
    expect(parse(single!.body)).toEqual({
      jsonrpc: '2.0',
      error: { code: -32601, message: FORBIDDEN_MESSAGE },
      id: null,
    });
    const batch = classify(
      JSON.stringify([call('eth_blockNumber', 1), call('trace_block', 2, ['0x1'])])
    );
    expect(batch?.status).toBe(403);
    expect(classify(JSON.stringify(call('parity_netPeers')))?.status).toBe(403);
  });

  it('answers 400 for bodies that are not JSON-RPC', () => {
    const notJson = classify('{"jsonrpc":');
    expect(notJson?.status).toBe(400);
    expect(parse(notJson!.body).error).toEqual({ code: -32700, message: 'Parse error' });

    for (const body of [
      JSON.stringify({ jsonrpc: '2.0', method: 42, id: 1 }),
      JSON.stringify({ jsonrpc: '2.0', params: [], id: 1 }),
      JSON.stringify([call('eth_blockNumber'), { jsonrpc: '2.0', method: null, id: 2 }]),
      JSON.stringify([call('eth_blockNumber'), null]),
      JSON.stringify([]),
      JSON.stringify('eth_blockNumber'),
      JSON.stringify([[call('eth_blockNumber')]]),
    ]) {
      const verdict = classify(body);
      expect(verdict?.status, body).toBe(400);
      expect(parse(verdict!.body).error.code, body).toBe(-32600);
    }
  });

  it('answers 413 when nginx did not buffer the body', () => {
    const verdict = classify(undefined);
    expect(verdict?.status).toBe(413);
    expect(parse(verdict!.body).error.code).toBe(-32600);
  });
});

describe('rpc(r)', () => {
  function fakeRequest(
    body: string | undefined,
    reply?: { status: number; responseText: string; contentType?: string }
  ) {
    const r = {
      requestText: body,
      headersOut: {} as Record<string, string | undefined>,
      return: vi.fn(),
      error: vi.fn(),
      subrequest: vi.fn(async () => ({
        status: reply?.status ?? 200,
        responseText: reply?.responseText ?? '',
        headersOut: { 'Content-Type': reply?.contentType },
      })),
    };
    return r;
  }

  it('refuses forbidden calls without touching the upstream', () => {
    const r = fakeRequest(JSON.stringify(call('trace_block')));
    rpc(r);
    expect(r.subrequest).not.toHaveBeenCalled();
    expect(r.return).toHaveBeenCalledWith(403, expect.stringContaining('-32601'));
    expect(r.headersOut['Content-Type']).toBe('application/json');
  });

  it('relays allowed calls to /_rpc and returns the upstream answer as is', async () => {
    const body = JSON.stringify(call('eth_blockNumber'));
    const r = fakeRequest(body, {
      status: 200,
      responseText: '{"jsonrpc":"2.0","id":1,"result":"0x10"}',
    });
    rpc(r);
    await Promise.resolve();
    await Promise.resolve();
    expect(r.subrequest).toHaveBeenCalledWith('/_rpc', { method: 'POST', body });
    expect(r.return).toHaveBeenCalledWith(200, '{"jsonrpc":"2.0","id":1,"result":"0x10"}');
  });
});
