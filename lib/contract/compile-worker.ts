/**
 * Solidity compilation off the request thread.
 *
 * `compileStandardJson()` runs solc in a `worker_threads` Worker
 * (`solc-worker.cjs`) with a heap limit and a timeout, through a small queue:
 * `config.compiler.concurrency` compiles at a time, at most
 * `config.compiler.maxQueue` requests waiting (the rest fail fast with
 * CompileQueueFullError → 503 + Retry-After). The worker loads only a compiler
 * that lib/contract/compiler-cache.ts verified, so a crash, an out-of-memory
 * or a hung compile ends with `worker.terminate()` and the request process
 * keeps serving other routes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { getCompilerConfig } from '../config';
import { logger } from '../logger';
import {
  CompilerDownloadError,
  CompilerIntegrityError,
  CompilerVersionError,
  getCompiler,
  type CompilerCacheOptions,
} from './compiler-cache';

/** Standard JSON input accepted per compile (matches the verify route's source limit). */
export const MAX_INPUT_BYTES = 500 * 1024;
/** Compiler output accepted per compile. */
export const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

export class CompileQueueFullError extends Error {
  readonly retryAfterSeconds = 10;
  constructor(
    readonly waiting: number,
    readonly maxQueue: number
  ) {
    super(`Compiler queue is full (${waiting}/${maxQueue} waiting)`);
    this.name = 'CompileQueueFullError';
  }
}

export class CompileTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Compilation exceeded ${timeoutMs} ms and was terminated`);
    this.name = 'CompileTimeoutError';
  }
}

export class CompileMemoryError extends Error {
  constructor(readonly limitMb: number) {
    super(`Compilation exceeded the ${limitMb} MB memory limit and was terminated`);
    this.name = 'CompileMemoryError';
  }
}

export class CompileInputTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`Compiler input is ${bytes} bytes; the limit is ${MAX_INPUT_BYTES}`);
    this.name = 'CompileInputTooLargeError';
  }
}

export class CompileOutputTooLargeError extends Error {
  constructor(message = `Compiler output exceeds ${MAX_OUTPUT_BYTES} bytes`) {
    super(message);
    this.name = 'CompileOutputTooLargeError';
  }
}

/** The worker crashed or answered unexpectedly. */
export class CompileWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompileWorkerError';
  }
}

export interface CompileRequest {
  /** Requested compiler version (`0.8.30`, `v0.8.30+commit.73712a01`, ...). */
  version: string;
  /** Standard JSON input, as object or already-serialized string. */
  input: string | Record<string, unknown>;
}

export interface CompileResult {
  /** Standard JSON output (string; callers JSON.parse it). */
  output: string;
  /** Short version actually used. */
  version: string;
  /** Long version of the compiler file (`0.8.30+commit.73712a01`). */
  longVersion: string;
  durationMs: number;
  /** Time spent waiting for a worker slot (and the compiler download). */
  waitMs: number;
}

export interface ResolvedCompiler {
  path: string;
  longVersion: string;
  version?: string;
}

export interface CompileOptions {
  concurrency?: number;
  maxQueue?: number;
  timeoutMs?: number;
  maxOldGenerationSizeMb?: number;
  /** Worker script (defaults to lib/contract/solc-worker.cjs). */
  workerPath?: string;
  /** Passed to getCompiler(). */
  compiler?: CompilerCacheOptions;
  /** Tests: supply the compiler file instead of the verified cache. */
  resolveCompiler?: (version: string) => Promise<ResolvedCompiler>;
}

type WorkerMessage =
  | { ok: true; output: string }
  | { ok: false; code: 'OUTPUT_TOO_LARGE' | 'COMPILE_ERROR'; error: string };

/** `lib/contract/solc-worker.cjs`, looked up from the working directory (Next.js bundles do not keep __dirname). */
export function defaultWorkerPath(): string {
  if (process.env.SOLC_WORKER_PATH) return process.env.SOLC_WORKER_PATH;
  const candidates = [
    path.join(process.cwd(), 'lib', 'contract', 'solc-worker.cjs'),
    path.join(__dirname, 'solc-worker.cjs'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

// ---------------------------------------------------------------------------
// Queue: `running` slots, FIFO `waiting`; a finished job hands its slot to the
// next waiter directly so the concurrency limit is never exceeded.

const queue = { running: 0, waiting: [] as Array<() => void> };

/** Current queue occupancy (for tests and diagnostics). */
export function compileQueueStats(): { running: number; waiting: number } {
  return { running: queue.running, waiting: queue.waiting.length };
}

async function acquireSlot(concurrency: number, maxQueue: number): Promise<void> {
  if (queue.running < concurrency) {
    queue.running += 1;
    return;
  }
  if (queue.waiting.length >= maxQueue) {
    throw new CompileQueueFullError(queue.waiting.length, maxQueue);
  }
  await new Promise<void>((resolve) => queue.waiting.push(resolve));
}

function releaseSlot(): void {
  const next = queue.waiting.shift();
  if (next) {
    next(); // the slot is handed over, `running` stays the same
    return;
  }
  queue.running = Math.max(0, queue.running - 1);
}

function runInWorker(params: {
  workerPath: string;
  compilerPath: string;
  input: string;
  timeoutMs: number;
  maxOldGenerationSizeMb: number;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      finish();
    };

    let worker: Worker;
    try {
      worker = new Worker(params.workerPath, {
        workerData: {
          compilerPath: params.compilerPath,
          input: params.input,
          maxOutputBytes: MAX_OUTPUT_BYTES,
        },
        resourceLimits: { maxOldGenerationSizeMb: params.maxOldGenerationSizeMb },
      });
    } catch (error) {
      reject(new CompileWorkerError(error instanceof Error ? error.message : String(error)));
      return;
    }

    timer = setTimeout(() => {
      settle(() => reject(new CompileTimeoutError(params.timeoutMs)));
      void worker.terminate();
    }, params.timeoutMs);

    worker.once('message', (message: WorkerMessage) => {
      settle(() => {
        if (message.ok) resolve(message.output);
        else if (message.code === 'OUTPUT_TOO_LARGE')
          reject(new CompileOutputTooLargeError(message.error));
        else reject(new CompileWorkerError(message.error));
      });
      void worker.terminate();
    });
    worker.once('error', (error: NodeJS.ErrnoException) => {
      settle(() =>
        reject(
          error.code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? new CompileMemoryError(params.maxOldGenerationSizeMb)
            : new CompileWorkerError(error.message)
        )
      );
    });
    worker.once('exit', (code) => {
      settle(() =>
        reject(new CompileWorkerError(`Compiler worker exited with code ${code} before answering`))
      );
    });
  });
}

/**
 * Compile Standard JSON input with the requested compiler version in a worker.
 * Resolves with the raw JSON output string; rejects with one of the Compile*
 * errors above or a Compiler* error from the cache.
 */
export async function compileStandardJson(
  request: CompileRequest,
  options: CompileOptions = {}
): Promise<CompileResult> {
  const config = getCompilerConfig();
  const concurrency = options.concurrency ?? config.concurrency;
  const maxQueue = options.maxQueue ?? config.maxQueue;
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const maxOldGenerationSizeMb = options.maxOldGenerationSizeMb ?? config.maxOldGenerationSizeMb;
  const workerPath = options.workerPath ?? defaultWorkerPath();

  const input = typeof request.input === 'string' ? request.input : JSON.stringify(request.input);
  const inputBytes = Buffer.byteLength(input, 'utf8');
  if (inputBytes > MAX_INPUT_BYTES) throw new CompileInputTooLargeError(inputBytes);

  const queuedAt = Date.now();
  let compiler: ResolvedCompiler;
  try {
    compiler = options.resolveCompiler
      ? await options.resolveCompiler(request.version)
      : await getCompiler(request.version, options.compiler);
  } catch (error) {
    logger.warn('solc compile: compiler unavailable', {
      version: request.version,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const version = compiler.version ?? request.version;
  const longVersion = compiler.longVersion;

  try {
    await acquireSlot(concurrency, maxQueue);
  } catch (error) {
    logger.warn('solc compile: queue full', { version, longVersion, maxQueue, concurrency });
    throw error;
  }

  const startedAt = Date.now();
  const waitMs = startedAt - queuedAt;
  try {
    const output = await runInWorker({
      workerPath,
      compilerPath: compiler.path,
      input,
      timeoutMs,
      maxOldGenerationSizeMb,
    });
    const durationMs = Date.now() - startedAt;
    logger.info('solc compile', {
      version,
      longVersion,
      result: 'ok',
      durationMs,
      waitMs,
      inputBytes,
      outputBytes: output.length,
    });
    return { output, version, longVersion, durationMs, waitMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const result =
      error instanceof CompileTimeoutError
        ? 'timeout'
        : error instanceof CompileMemoryError
          ? 'out-of-memory'
          : error instanceof CompileOutputTooLargeError
            ? 'output-too-large'
            : 'error';
    logger.warn('solc compile', {
      version,
      longVersion,
      result,
      durationMs,
      waitMs,
      inputBytes,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    releaseSlot();
  }
}

export interface CompileErrorDescription {
  status: number;
  code: string;
  message: string;
  retryAfter?: number;
}

/** HTTP status / code / message for a compile failure (shared by the verification routes). */
export function describeCompileError(error: unknown): CompileErrorDescription {
  if (error instanceof CompileQueueFullError) {
    return {
      status: 503,
      code: 'COMPILER_BUSY',
      message: 'The compiler is busy; retry in a few seconds',
      retryAfter: error.retryAfterSeconds,
    };
  }
  if (error instanceof CompileTimeoutError) {
    return { status: 504, code: 'COMPILE_TIMEOUT', message: error.message };
  }
  if (error instanceof CompileMemoryError) {
    return { status: 422, code: 'COMPILE_OUT_OF_MEMORY', message: error.message };
  }
  if (error instanceof CompileInputTooLargeError) {
    return { status: 413, code: 'COMPILE_INPUT_TOO_LARGE', message: error.message };
  }
  if (error instanceof CompileOutputTooLargeError) {
    return { status: 422, code: 'COMPILE_OUTPUT_TOO_LARGE', message: error.message };
  }
  if (error instanceof CompilerVersionError) {
    return { status: 400, code: 'UNSUPPORTED_COMPILER_VERSION', message: error.message };
  }
  if (error instanceof CompilerIntegrityError) {
    return {
      status: 502,
      code: 'COMPILER_INTEGRITY',
      message: 'The compiler download failed verification and was discarded',
    };
  }
  if (error instanceof CompilerDownloadError) {
    return {
      status: 502,
      code: 'COMPILER_DOWNLOAD',
      message: 'The compiler could not be downloaded',
    };
  }
  if (error instanceof CompileWorkerError) {
    return { status: 500, code: 'COMPILER_WORKER', message: error.message };
  }
  return {
    status: 500,
    code: 'COMPILE_FAILED',
    message: error instanceof Error ? error.message : String(error),
  };
}
