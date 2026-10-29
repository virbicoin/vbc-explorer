/**
 * lib/contract/compile-worker.ts with the solc build bundled in node_modules
 * as the "verified" compiler: same output as a direct solc.compile, timeouts
 * terminate the worker, the queue refuses excess requests with 503 semantics,
 * and oversized input never reaches a worker.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import solc from 'solc';
import {
  CompileInputTooLargeError,
  CompileQueueFullError,
  CompileTimeoutError,
  CompileWorkerError,
  MAX_INPUT_BYTES,
  compileQueueStats,
  compileStandardJson,
  describeCompileError,
  type CompileOptions,
} from '@/lib/contract/compile-worker';
import { CompilerVersionError } from '@/lib/contract/compiler-cache';

const BUNDLED = path.join(process.cwd(), 'node_modules', 'solc', 'soljson.js');
const bundled: CompileOptions['resolveCompiler'] = async () => ({
  path: BUNDLED,
  longVersion: `${(solc as unknown as { version: () => string }).version()}`,
  version: 'bundled',
});

const SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract Hello {
  uint256 public value;
  function set(uint256 v) external { value = v; }
}`;

const input = {
  language: 'Solidity',
  sources: { 'Hello.sol': { content: SOURCE } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] },
    },
  },
};

describe('compileStandardJson', () => {
  it('compiles in a worker and produces the same output as a direct solc.compile', async () => {
    const result = await compileStandardJson(
      { version: '0.8.38', input },
      { resolveCompiler: bundled }
    );
    const viaWorker = JSON.parse(result.output);
    const direct = JSON.parse(solc.compile(JSON.stringify(input)));
    expect(viaWorker).toEqual(direct);
    expect(viaWorker.contracts['Hello.sol'].Hello.evm.bytecode.object).toMatch(/^[0-9a-f]+$/);
    expect(result.version).toBe('bundled');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(compileQueueStats()).toEqual({ running: 0, waiting: 0 });
  }, 120_000);

  it('terminates the worker when the timeout elapses', async () => {
    await expect(
      compileStandardJson({ version: '0.8.38', input }, { resolveCompiler: bundled, timeoutMs: 1 })
    ).rejects.toBeInstanceOf(CompileTimeoutError);
    expect(compileQueueStats()).toEqual({ running: 0, waiting: 0 });
  }, 120_000);

  it('refuses requests beyond the queue limit while the others complete', async () => {
    const options: CompileOptions = { resolveCompiler: bundled, concurrency: 1, maxQueue: 1 };
    const outcomes = await Promise.allSettled([
      compileStandardJson({ version: '0.8.38', input }, options),
      compileStandardJson({ version: '0.8.38', input }, options),
      compileStandardJson({ version: '0.8.38', input }, options),
    ]);
    const rejected = outcomes.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(CompileQueueFullError);
    expect(describeCompileError(rejected[0].reason)).toMatchObject({ status: 503, retryAfter: 10 });
    expect(compileQueueStats()).toEqual({ running: 0, waiting: 0 });
  }, 180_000);

  it('rejects oversized input before starting a worker', async () => {
    const huge = { ...input, sources: { 'Big.sol': { content: 'x'.repeat(MAX_INPUT_BYTES + 1) } } };
    await expect(
      compileStandardJson({ version: '0.8.38', input: huge }, { resolveCompiler: bundled })
    ).rejects.toBeInstanceOf(CompileInputTooLargeError);
  });

  it('surfaces a crashed worker as CompileWorkerError and keeps serving', async () => {
    await expect(
      compileStandardJson(
        { version: '0.8.38', input },
        {
          resolveCompiler: async () => ({
            path: path.join(process.cwd(), 'does-not-exist.js'),
            longVersion: 'missing',
          }),
        }
      )
    ).rejects.toBeInstanceOf(CompileWorkerError);
    expect(compileQueueStats()).toEqual({ running: 0, waiting: 0 });
  }, 120_000);

  it('propagates compiler-version refusals from the cache layer', async () => {
    await expect(
      compileStandardJson({ version: '0.8.31-nightly.2025.1.1+commit.abcdef12', input })
    ).rejects.toBeInstanceOf(CompilerVersionError);
    expect(describeCompileError(new CompilerVersionError('x')).status).toBe(400);
  });
});

describe('describeCompileError', () => {
  it('maps the failure classes to HTTP statuses', () => {
    expect(describeCompileError(new CompileTimeoutError(60_000)).status).toBe(504);
    expect(describeCompileError(new CompileInputTooLargeError(1)).status).toBe(413);
    expect(describeCompileError(new CompileWorkerError('boom')).status).toBe(500);
    expect(describeCompileError(new Error('other'))).toMatchObject({
      status: 500,
      code: 'COMPILE_FAILED',
    });
  });
});
