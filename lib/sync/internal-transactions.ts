/**
 * Internal transactions (calls, contract creations and selfdestructs made inside a
 * transaction) from the node's call traces, stored in `InternalTransaction`
 * (tools/internal-txs.ts).
 *
 * - The source is the Parity-style `trace_transaction` (OpenEthereum / Ovbc with
 *   `--tracing on`; Erigon and Nethermind answer it too). On Ovbc the trace API is
 *   usually only open on the IPC socket, which `createTraceSource()` accepts.
 * - Every frame except the top-level call is stored, as on Blockscout: the
 *   top-level call is the transaction itself, a top-level creation is kept
 *   because it names the created contract. Block rewards are not internal
 *   transactions.
 * - `error` is the frame's own error; `reverted` also covers the frames below a
 *   failed one, whose effects (value moved, contract created) were undone.
 * - Writes go block range by block range and replace whatever the range held,
 *   so a run can be repeated, and a transaction that moved to another block in
 *   a reorganisation never keeps its old frames. The progress marker
 *   (scan_progress 'internal-transactions') is handled by lib/sync/range-scan.ts.
 */

import { ethers } from 'ethers';
import { Block, InternalTransaction, Transaction } from '../../models/index';

/** One frame of a `trace_transaction` answer. */
export interface ParityTrace {
  type: string;
  action: {
    callType?: string;
    from?: string;
    to?: string;
    value?: string;
    gas?: string;
    input?: string;
    init?: string;
    creationMethod?: string;
    address?: string;
    refundAddress?: string;
    balance?: string;
  };
  result?: { gasUsed?: string; output?: string; address?: string; code?: string } | null;
  error?: string;
  subtraces?: number;
  traceAddress?: number[];
  transactionHash?: string | null;
  transactionPosition?: number | null;
  blockHash?: string;
  blockNumber?: number;
}

/** The stored form of one frame (see models/index.ts IInternalTransaction). */
export interface InternalTransactionDoc {
  transactionHash: string;
  index: number;
  traceAddress: number[];
  blockNumber: number;
  blockHash: string;
  transactionIndex: number;
  timestamp: number;
  type: string;
  callType: string | null;
  from: string;
  to: string | null;
  createdContract?: string;
  value: string;
  gas: string;
  gasUsed: string | null;
  error: string | null;
  reverted: boolean;
}

/** The transaction a trace belongs to, as stored in `Transaction`. */
export interface TraceContext {
  transactionHash: string;
  blockNumber: number;
  blockHash: string;
  transactionIndex: number;
  timestamp: number;
}

const lower = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value.toLowerCase() : null;

/** Decimal string of a hex quantity ('0' for a missing or empty one). */
export function quantity(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(value).toString();
  if (typeof value !== 'string' || value === '' || value === '0x') return '0';
  return BigInt(value).toString();
}

const pathKey = (path: number[]) => path.join(',');

/**
 * The documents of a transaction's trace. Frames keep their position in the
 * trace as `index`; the top-level call is left out and reward frames ignored.
 */
export function internalTransactionsFromTraces(
  traces: ParityTrace[],
  context: TraceContext
): InternalTransactionDoc[] {
  const frames = traces.filter((trace) => trace.type !== 'reward');
  const failed = new Set(
    frames.filter((trace) => trace.error).map((trace) => pathKey(trace.traceAddress ?? []))
  );
  const docs: InternalTransactionDoc[] = [];

  frames.forEach((trace, index) => {
    const path = trace.traceAddress ?? [];
    if (trace.type === 'call' && path.length === 0) return; // the transaction itself

    let reverted = Boolean(trace.error);
    for (let depth = 0; !reverted && depth < path.length; depth++) {
      if (failed.has(pathKey(path.slice(0, depth)))) reverted = true;
    }

    const { action } = trace;
    const result = trace.result ?? null;
    const base = {
      transactionHash: context.transactionHash,
      index,
      traceAddress: path,
      blockNumber: context.blockNumber,
      blockHash: context.blockHash,
      transactionIndex: context.transactionIndex,
      timestamp: context.timestamp,
      gasUsed: result?.gasUsed !== undefined ? quantity(result.gasUsed) : null,
      error: trace.error ?? null,
      reverted,
    };

    if (trace.type === 'call') {
      docs.push({
        ...base,
        type: 'call',
        callType: action.callType ?? 'call',
        from: lower(action.from) ?? '',
        to: lower(action.to),
        value: quantity(action.value),
        gas: quantity(action.gas),
      });
    } else if (trace.type === 'create') {
      const created = trace.error ? null : lower(result?.address);
      docs.push({
        ...base,
        type: action.creationMethod === 'create2' ? 'create2' : 'create',
        callType: null,
        from: lower(action.from) ?? '',
        to: null,
        ...(created ? { createdContract: created } : {}),
        value: quantity(action.value),
        gas: quantity(action.gas),
      });
    } else if (trace.type === 'suicide' || trace.type === 'selfdestruct') {
      docs.push({
        ...base,
        type: 'selfdestruct',
        callType: null,
        from: lower(action.address) ?? '',
        to: lower(action.refundAddress),
        value: quantity(action.balance),
        gas: '0',
        gasUsed: null,
      });
    }
  });
  return docs;
}

// ---------------------------------------------------------------------------
// Trace source

export interface TraceSource {
  /** The trace of a transaction; null or [] when the node does not know it. */
  traceTransaction(hash: string): Promise<ParityTrace[] | null>;
  close(): void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Where the traces come from, without credentials: an IPC socket path
 * (optionally `ipc://`-prefixed) or an http(s) / ws(s) URL.
 */
export function describeTraceSource(url: string): string {
  if (/^(https?|wss?):\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return 'invalid URL';
    }
  }
  return `ipc ${url.replace(/^ipc:\/\//i, '')}`;
}

/** A trace source over the node's IPC socket or JSON-RPC URL (reconnects after a failure). */
export function createTraceSource(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): TraceSource {
  let provider: ethers.JsonRpcApiProvider | null = null;
  const options = { staticNetwork: true, batchMaxCount: 1 };
  const open = () => {
    if (provider) return provider;
    if (/^https?:\/\//i.test(url)) provider = new ethers.JsonRpcProvider(url, undefined, options);
    else if (/^wss?:\/\//i.test(url))
      provider = new ethers.WebSocketProvider(url, undefined, options);
    else provider = new ethers.IpcSocketProvider(url.replace(/^ipc:\/\//i, ''), undefined, options);
    return provider;
  };
  const close = () => {
    try {
      provider?.destroy();
    } catch {
      // already gone
    }
    provider = null;
  };
  return {
    async traceTransaction(hash) {
      try {
        const result = await withTimeout(
          open().send('trace_transaction', [hash]),
          timeoutMs,
          'trace_transaction'
        );
        return Array.isArray(result) ? (result as ParityTrace[]) : null;
      } catch (error) {
        close(); // the next call opens a new connection
        throw error;
      }
    },
    close,
  };
}

// ---------------------------------------------------------------------------
// Indexing

export interface IndexRangeOptions {
  /** Transactions traced at the same time (default 4). */
  concurrency?: number;
  /** A range is cut after the block that brings it over this many transactions (default 500). */
  maxTransactions?: number;
  /** Transactions to treat as having no internal transactions (they could not be traced). */
  skip?: ReadonlySet<string>;
}

export interface IndexRangeFailure {
  blockNumber: number;
  transactionHash: string;
  reason: string;
}

export interface IndexRangeResult {
  from: number;
  /** Last block written; from - 1 when nothing could be written. */
  committedTo: number;
  transactions: number;
  internalTransactions: number;
  /** Contracts created inside the committed transactions (successful creations only). */
  createdContracts: Array<{
    address: string;
    creator: string;
    transactionHash: string;
    blockNumber: number;
  }>;
  /** The first transaction that could not be traced; blocks from its block on are not written. */
  failure: IndexRangeFailure | null;
}

interface StoredTransaction {
  hash: string;
  blockNumber: number;
  blockHash?: string;
  transactionIndex?: number;
  timestamp?: number;
}

/** Transactions of [from, to] in block order, cut after whole blocks at `maxTransactions`. */
async function loadRangeTransactions(from: number, to: number, maxTransactions: number) {
  const rows = (await Transaction.find({ blockNumber: { $gte: from, $lte: to } })
    .select('hash blockNumber blockHash transactionIndex timestamp')
    .sort({ blockNumber: 1, transactionIndex: 1 })
    .limit(maxTransactions + 1)
    .lean()) as StoredTransaction[];
  if (rows.length <= maxTransactions) return { rows, to };
  // Over the cap: stop before the block of the first transaction past it, unless that
  // block is the first one (a single block is never split)
  const cutBlock = rows[maxTransactions].blockNumber;
  if (cutBlock > from) {
    return { rows: rows.filter((row) => row.blockNumber < cutBlock), to: cutBlock - 1 };
  }
  const whole = (await Transaction.find({ blockNumber: from })
    .select('hash blockNumber blockHash transactionIndex timestamp')
    .sort({ transactionIndex: 1 })
    .lean()) as StoredTransaction[];
  return { rows: whole, to: from };
}

async function blockTimes(heights: number[]): Promise<Map<number, number>> {
  if (heights.length === 0) return new Map();
  const blocks = (await Block.find({ number: { $in: heights } })
    .select('number timestamp')
    .lean()) as Array<{ number: number; timestamp?: number }>;
  return new Map(blocks.map((block) => [block.number, Number(block.timestamp) || 0]));
}

/**
 * Trace the stored transactions of blocks [from, to] and replace the range's
 * internal transactions. Only whole blocks below the first transaction that
 * cannot be traced (unknown to the node, or traced in another block than the
 * stored one) are written. Connection errors are thrown.
 */
export async function indexInternalTransactions(
  source: TraceSource,
  from: number,
  to: number,
  options: IndexRangeOptions = {}
): Promise<IndexRangeResult> {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const { rows, to: rangeEnd } = await loadRangeTransactions(
    from,
    to,
    Math.max(1, options.maxTransactions ?? 500)
  );
  const missingTimes = await blockTimes([
    ...new Set(rows.filter((row) => !row.timestamp).map((row) => row.blockNumber)),
  ]);

  const traced = new Map<string, InternalTransactionDoc[]>();
  let failure: IndexRangeFailure | null = null;
  const fail = (row: StoredTransaction, reason: string) => {
    if (!failure || row.blockNumber < failure.blockNumber) {
      failure = { blockNumber: row.blockNumber, transactionHash: row.hash, reason };
    }
  };

  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++];
      const hash = row.hash.toLowerCase();
      if (failure && row.blockNumber >= failure.blockNumber) continue;
      if (options.skip?.has(hash)) {
        traced.set(hash, []);
        continue;
      }
      const traces = await source.traceTransaction(hash);
      if (!traces || traces.length === 0) {
        fail(row, 'the node has no trace for this transaction');
        continue;
      }
      const head = traces[0];
      const tracedBlockHash = lower(head.blockHash);
      const storedBlockHash = lower(row.blockHash);
      if (lower(head.transactionHash) !== hash) {
        fail(row, 'the trace belongs to another transaction');
        continue;
      }
      if (tracedBlockHash && storedBlockHash && tracedBlockHash !== storedBlockHash) {
        fail(row, `stored in block ${storedBlockHash}, traced in block ${tracedBlockHash}`);
        continue;
      }
      traced.set(
        hash,
        internalTransactionsFromTraces(traces, {
          transactionHash: hash,
          blockNumber: row.blockNumber,
          blockHash: storedBlockHash ?? tracedBlockHash ?? '',
          transactionIndex: Number(row.transactionIndex ?? head.transactionPosition ?? 0),
          timestamp: Number(row.timestamp) || missingTimes.get(row.blockNumber) || 0,
        })
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length || 1) }, worker));

  const failedAt = (failure as IndexRangeFailure | null)?.blockNumber;
  const committedTo = failedAt !== undefined ? failedAt - 1 : rangeEnd;
  const committed = rows.filter((row) => row.blockNumber <= committedTo);
  const docs = committed.flatMap((row) => traced.get(row.hash.toLowerCase()) ?? []);

  if (committedTo >= from) {
    const hashes = committed.map((row) => row.hash.toLowerCase());
    // the range is rewritten as a whole: frames of transactions that left it go too
    await InternalTransaction.collection.deleteMany({
      $or: [
        { blockNumber: { $gte: from, $lte: committedTo } },
        ...(hashes.length > 0 ? [{ transactionHash: { $in: hashes } }] : []),
      ],
    });
    for (let start = 0; start < docs.length; start += 1000) {
      await InternalTransaction.collection.insertMany(docs.slice(start, start + 1000), {
        ordered: false,
      });
    }
  }

  return {
    from,
    committedTo,
    transactions: committed.length,
    internalTransactions: docs.length,
    createdContracts: docs
      .filter((doc) => doc.createdContract && !doc.reverted)
      .map((doc) => ({
        address: doc.createdContract as string,
        creator: doc.from,
        transactionHash: doc.transactionHash,
        blockNumber: doc.blockNumber,
      })),
    failure,
  };
}
