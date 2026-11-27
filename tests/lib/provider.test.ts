/**
 * callContract() (lib/web3/provider.ts), the one way the server calls a view function: against a
 * fake JSON-RPC node that answers eth_call by function selector.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeAbiParameters, parseAbiParameters, toFunctionSelector } from 'viem';
import { callContract, resetClient } from '@/lib/web3/provider';

// viem decodes addresses with checksum capitals; callContract() gives them back in lower case
const TOKEN0 = '0xabcdef0123456789abcdef0123456789abcdef01';
const answers: Record<string, string> = {
  [toFunctionSelector('name()')]: encodeAbiParameters(parseAbiParameters('string'), ['Gold']),
  [toFunctionSelector('token0()')]: encodeAbiParameters(parseAbiParameters('address'), [TOKEN0]),
  [toFunctionSelector('getReserves()')]: encodeAbiParameters(
    parseAbiParameters('uint256, uint256'),
    [5n, 7n]
  ),
};

let node: http.Server;
let previousUrl: string | undefined;

beforeAll(async () => {
  node = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const call = JSON.parse(raw) as { id: number; params: [{ data: string }] };
      const result = answers[call.params[0].data.slice(0, 10)];
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify(
          result
            ? { jsonrpc: '2.0', id: call.id, result }
            : { jsonrpc: '2.0', id: call.id, error: { code: 3, message: 'execution reverted' } }
        )
      );
    });
  });
  await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
  previousUrl = process.env.WEB3_PROVIDER_URL;
  process.env.WEB3_PROVIDER_URL = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;
  resetClient();
});

afterAll(async () => {
  if (previousUrl === undefined) delete process.env.WEB3_PROVIDER_URL;
  else process.env.WEB3_PROVIDER_URL = previousUrl;
  resetClient();
  await new Promise((resolve) => node.close(resolve));
});

const ADDRESS = '0x00000000000000000000000000000000000000aa';
const ABI = [
  'function name() view returns (string)',
  'function token0() view returns (address)',
  'function getReserves() view returns (uint256 reserve0, uint256 reserve1)',
  'function symbol() view returns (string)',
];

describe('callContract', () => {
  it('takes a human-readable ABI and returns one output as its value, addresses in lower case', async () => {
    expect(await callContract(ABI, ADDRESS, 'name')).toBe('Gold');
    expect(await callContract(ABI, ADDRESS, 'token0')).toBe(TOKEN0);
  });

  it('returns several outputs as an array that also carries their names', async () => {
    const reserves = await callContract(ABI, ADDRESS, 'getReserves');
    const [reserve0, reserve1] = reserves;
    expect([reserve0, reserve1]).toEqual([5n, 7n]);
    expect(reserves.reserve1).toBe(7n);
  });

  it('throws a one-line error when the call reverts', async () => {
    const error = await callContract(ABI, ADDRESS, 'symbol').catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^symbol\(\): /);
    expect((error as Error).message).not.toContain('\n');
  });
});
