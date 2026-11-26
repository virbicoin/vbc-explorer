/**
 * POST /api/contract/verify compiles and stores exactly the submitted source. It used to trim it,
 * drop block comments, other contracts and non-ASCII characters and rewrite `throw` / `var`
 * before compiling, so the metadata never matched (no full match), unicode string literals broke
 * and the stored "verified source" was not the developer's.
 *
 * The node is a local JSON-RPC server answering eth_getCode; the compiler is the bundled solc.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import solc from 'solc';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Contract } from '@/models/index';
import { compileStandardJson, type CompileOptions } from '@/lib/contract/compile-worker';

const BUNDLED = path.join(process.cwd(), 'node_modules', 'solc', 'soljson.js');
const bundled: CompileOptions['resolveCompiler'] = async () => ({
  path: BUNDLED,
  longVersion: `${(solc as unknown as { version: () => string }).version()}`,
  version: 'bundled',
});

// Whatever version the request names, compile with the bundled solc
vi.mock('@/lib/contract/compile-worker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/contract/compile-worker')>();
  return {
    ...actual,
    compileStandardJson: (request: Parameters<typeof actual.compileStandardJson>[0]) =>
      actual.compileStandardJson(request, { resolveCompiler: bundled }),
  };
});

const ADDRESS = `0x${'9e7'.padEnd(40, '0')}`;
const SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title Greeter
 * @notice 日本語のコメントも検証済みソースに残る
 */
contract Greeter {
    string public greeting = unicode"こんにちは";
    string public note = "never throw here";

    /// @param value the new greeting
    function set(string calldata value) external {
        greeting = value;
    }
}

contract Unused {
    uint256 public x;
}
`;

// The input the route builds for a single file (source key = contract name)
const routeInput = {
  language: 'Solidity',
  sources: { Greeter: { content: SOURCE } },
  settings: {
    outputSelection: {
      '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'evm.methodIdentifiers'] },
    },
    optimizer: { enabled: false, runs: 200 },
    evmVersion: 'paris',
    metadata: { bytecodeHash: 'ipfs', useLiteralContent: false },
    viaIR: false,
  },
};

let mongod: MongoMemoryServer;
let node: http.Server;
let onchainCode = '0x';
let POST: (request: NextRequest, context: never) => Promise<Response>;

beforeAll(async () => {
  const compiled = await compileStandardJson(
    { version: 'bundled', input: routeInput },
    { resolveCompiler: bundled }
  );
  const output = JSON.parse(compiled.output) as {
    contracts: Record<string, Record<string, { evm: { deployedBytecode: { object: string } } }>>;
  };
  onchainCode = `0x${output.contracts.Greeter.Greeter.evm.deployedBytecode.object}`;

  node = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const call = JSON.parse(raw) as { id: number; method: string };
      const result = call.method === 'eth_getCode' ? onchainCode : null;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }));
    });
  });
  await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
  process.env.WEB3_PROVIDER_URL = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;

  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('explorerDB_verify_source');
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });

  ({ POST } = (await import('@/app/api/contract/verify/route')) as unknown as {
    POST: typeof POST;
  });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
  await new Promise((resolve) => node?.close(resolve));
});

describe('POST /api/contract/verify (single file)', () => {
  it('verifies the exact submitted source as a full match and stores it unchanged', async () => {
    const request = new NextRequest('https://explorer.example/api/contract/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-ip': '198.51.100.7' },
      body: JSON.stringify({
        address: ADDRESS,
        sourceCode: SOURCE,
        compilerVersion: '0.8.30',
        contractName: 'Greeter',
        optimization: false,
        optimizationRuns: 200,
        evmVersion: 'paris',
      }),
    });
    const response = await POST(request, undefined as never);
    const body = await response.json();
    expect(body).toMatchObject({ verified: true, message: 'Contract successfully verified' });

    const stored = (await Contract.collection.findOne({ address: ADDRESS })) as {
      sourceCode?: string;
      contractName?: string;
    } | null;
    expect(stored?.contractName).toBe('Greeter');
    expect(stored?.sourceCode).toBe(SOURCE);
  }, 120_000);
});
