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
import { requestedLicense } from '@/lib/contract/verify';
import { POST as flattenedPost } from '@/app/api/v2/smart-contracts/[address]/verification/via/flattened-code/route';
import { POST as standardInputPost } from '@/app/api/v2/smart-contracts/[address]/verification/via/standard-input/route';

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

/** A contract address of its own per test: a verified address is never verified again. */
const addressFor = (tag: string) => `0x${tag.padEnd(40, '0')}`;
let clientIp = 20;
const nextIp = () => `198.51.100.${(clientIp += 1)}`;
const v2Url = (address: string, via: string) =>
  `https://explorer.example/api/v2/smart-contracts/${address}/verification/via/${via}`;

describe('the shared verification flow (lib/contract/verify.ts)', () => {
  it('finds the deployed contract among several when no name is given', async () => {
    const address = addressFor('a01');
    const request = new NextRequest('https://explorer.example/api/contract/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-ip': nextIp() },
      body: JSON.stringify({
        address,
        sourceCode: SOURCE,
        compilerVersion: '0.8.30',
        optimization: false,
        optimizationRuns: 200,
        evmVersion: 'paris',
      }),
    });
    const body = await (await POST(request, undefined as never)).json();
    // the file's last contract (Unused) names the source unit, so only the metadata differs
    expect(body).toMatchObject({
      verified: true,
      message: 'Contract successfully verified (partial match: metadata differs)',
    });
    const stored = await Contract.collection.findOne({ address });
    expect(stored).toMatchObject({ contractName: 'Greeter', sourceCode: SOURCE, license: 'MIT' });
    // the release that compiled it, with its commit
    expect(String(stored?.compilerVersion)).toMatch(/^0\.8\.\d+\+commit\./);
  }, 120_000);

  it('reads a standard JSON file uploaded to the v2 route and stores the text as sent', async () => {
    const address = addressFor('a02');
    const text = JSON.stringify(
      {
        language: 'Solidity',
        sources: { Greeter: { content: SOURCE } },
        settings: {
          optimizer: { enabled: false, runs: 200 },
          evmVersion: 'paris',
          metadata: { bytecodeHash: 'ipfs', useLiteralContent: false },
          viaIR: false,
        },
      },
      null,
      2
    );
    const form = new FormData();
    form.set('compiler_version', 'v0.8.30+commit.73712a01');
    form.set('contract_name', 'Greeter:Greeter');
    form.set('license_type', 'mit');
    form.set('files[0]', new File([text], 'input.json', { type: 'application/json' }));
    const response = await standardInputPost(
      new NextRequest(v2Url(address, 'standard-input'), {
        method: 'POST',
        headers: { 'x-client-ip': nextIp() },
        body: form,
      }),
      { params: Promise.resolve({ address }) }
    );
    expect(await response.json()).toEqual({ message: 'Smart-contract verification started' });
    expect(response.status).toBe(200);
    const stored = await Contract.collection.findOne({ address });
    expect(stored).toMatchObject({ contractName: 'Greeter', sourceCode: text, license: 'MIT' });
  }, 120_000);

  it('takes a JSON boolean optimizer flag on the v2 flattened route', async () => {
    const address = addressFor('a03');
    const deployed = {
      language: 'Solidity',
      sources: { 'Greeter.sol': { content: SOURCE } },
      settings: {
        outputSelection: { '*': { '*': ['evm.deployedBytecode'] } },
        optimizer: { enabled: true, runs: 200 },
        evmVersion: 'paris',
      },
    };
    const compiled = await compileStandardJson(
      { version: 'bundled', input: deployed },
      { resolveCompiler: bundled }
    );
    const previous = onchainCode;
    onchainCode = `0x${JSON.parse(compiled.output).contracts['Greeter.sol'].Greeter.evm.deployedBytecode.object}`;
    try {
      const response = await flattenedPost(
        new NextRequest(v2Url(address, 'flattened-code'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-client-ip': nextIp() },
          body: JSON.stringify({
            compiler_version: 'v0.8.30+commit.73712a01',
            source_code: SOURCE,
            contract_name: 'Greeter',
            is_optimization_enabled: true,
            optimization_runs: 200,
            evm_version: 'paris',
          }),
        }),
        { params: Promise.resolve({ address }) }
      );
      expect(response.status).toBe(200);
      const stored = await Contract.collection.findOne({ address });
      expect(stored).toMatchObject({ verified: true, optimization: true, optimizationRuns: 200 });
    } finally {
      onchainCode = previous;
    }
  }, 120_000);

  it('answers a contract name the source does not declare', async () => {
    const address = addressFor('a04');
    const response = await flattenedPost(
      new NextRequest(v2Url(address, 'flattened-code'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-client-ip': nextIp() },
        body: JSON.stringify({
          compiler_version: 'v0.8.30+commit.73712a01',
          source_code: SOURCE,
          contract_name: 'Nope',
        }),
      }),
      { params: Promise.resolve({ address }) }
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Contract 'Nope' not found in compilation output",
    });
    expect(await Contract.collection.findOne({ address })).toBeNull();
  }, 120_000);

  it('reads the license as an SPDX id, an Etherscan number or a Blockscout name', () => {
    expect(requestedLicense('3')).toBe('MIT');
    expect(requestedLicense('gnu_gpl_v3')).toBe('GPL-3.0');
    expect(requestedLicense('Apache-2.0')).toBe('Apache-2.0');
    expect(requestedLicense('1')).toBeNull();
    expect(requestedLicense('none')).toBeNull();
    expect(requestedLicense('')).toBeNull();
    expect(requestedLicense('not a <license>')).toBeNull();
  });
});
