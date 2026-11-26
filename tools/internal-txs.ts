#!/usr/bin/env node
/**
 * Internal transaction indexer (pm2 app `internal-txs`).
 *
 * Traces every stored transaction through the node's `trace_transaction` and
 * keeps `InternalTransaction` in step with the chain (lib/sync/internal-transactions.ts).
 * It follows the confirmed part of the chain only (the stored head minus
 * `sync.confirmations`), so the live listener's reorg handling and this
 * indexer do not work on the same heights; deeper reorganisations rewind its
 * marker (lib/sync/range-scan.ts) and the heights are indexed again.
 * Contracts created by contracts are registered in `Contract` like the ones
 * a transaction creates (lib/sync/contracts.ts).
 *
 * Usage:
 *   npm run internal-txs                    # follow the chain
 *   npm run internal-txs -- --once          # index up to the confirmed head, then exit
 *   npm run internal-txs -- --from <block>  # start again at <block> (combine with --once)
 *   npm run internal-txs -- --status        # marker, documents, skipped transactions
 *
 * Source: `traces.url` in config.json or TRACE_RPC_URL (IPC socket path or URL).
 */

import '../lib/env'; // .env / .env.local before any other module reads process.env
import mongoose from 'mongoose';
import {
  connectDB,
  ensureIndexesOnStartup,
  InternalTransaction,
  ScanProgress,
} from '../models/index';
import { getTraceSourceUrl, getWeb3ProviderURL, readConfig } from '../lib/config';
import { logger } from '../lib/logger';
import {
  createTraceSource,
  describeTraceSource,
  indexInternalTransactions,
  type IndexRangeFailure,
  type TraceSource,
} from '../lib/sync/internal-transactions';
import {
  claimRange,
  completeRange,
  loadRangeScan,
  loadSkipped,
  recordSkipped,
  resetRangeScan,
} from '../lib/sync/range-scan';
import { dbHeadNumber, resolveSyncSettings } from '../lib/sync/reorg';
import { registerContract } from '../lib/sync/contracts';

const SCAN = 'internal-transactions' as const;
const POLL_MS = 15_000;
const RETRY_MS = 60_000;
const IDLE_MS = 60 * 60 * 1000;
const RANGE_BLOCKS = 20_000;
/** Cycles a transaction may fail to trace before it is skipped (and recorded). */
const MAX_ATTEMPTS = 3;

export interface IndexToHeadResult {
  ranges: number;
  transactions: number;
  internalTransactions: number;
  createdContracts: number;
  lastScannedBlock: number;
  /** The transaction that stopped this run (it is retried on the next one). */
  pending: IndexRangeFailure | null;
}

export interface IndexToHeadOptions {
  confirmations: number;
  concurrency?: number;
  /** Failed attempts per transaction hash, kept across runs by the caller. */
  attempts?: Map<string, number>;
  /** Called for every contract a contract created (best effort). */
  onContractCreated?: (created: {
    address: string;
    creator: string;
    transactionHash: string;
    blockNumber: number;
  }) => Promise<void>;
  /** Stop after this many ranges (tests). */
  maxRanges?: number;
}

/**
 * Index every stored transaction up to the confirmed head
 * (stored head − confirmations − 1). Connection errors are thrown.
 */
export async function indexToConfirmedHead(
  source: TraceSource,
  options: IndexToHeadOptions
): Promise<IndexToHeadResult> {
  const attempts = options.attempts ?? new Map<string, number>();
  const skipped = await loadSkipped(SCAN);
  const total: IndexToHeadResult = {
    ranges: 0,
    transactions: 0,
    internalTransactions: 0,
    createdContracts: 0,
    lastScannedBlock: -1,
    pending: null,
  };

  for (;;) {
    if (options.maxRanges !== undefined && total.ranges >= options.maxRanges) break;
    const head = await dbHeadNumber();
    const state = await loadRangeScan(SCAN);
    total.lastScannedBlock = state.lastScannedBlock;
    if (head === null) break;
    const confirmedHead = head - options.confirmations - 1;
    if (state.lastScannedBlock >= confirmedHead) break;

    const from = state.lastScannedBlock + 1;
    const to = Math.min(from + RANGE_BLOCKS - 1, confirmedHead);
    if (!(await claimRange(SCAN, state, to))) continue; // the marker moved: read it again

    const result = await indexInternalTransactions(source, from, to, {
      concurrency: options.concurrency,
      skip: skipped,
    });
    for (const created of result.createdContracts) {
      try {
        await options.onContractCreated?.(created);
      } catch (error) {
        logger.warn('Contract registration failed', {
          address: created.address,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!(await completeRange(SCAN, state, result.committedTo))) {
      logger.warn('Internal transactions: a reorganisation touched the range; indexing it again', {
        from,
        to,
      });
      continue;
    }
    total.ranges++;
    total.transactions += result.transactions;
    total.internalTransactions += result.internalTransactions;
    total.createdContracts += result.createdContracts.length;
    total.lastScannedBlock = Math.max(result.committedTo, state.lastScannedBlock);

    if (result.failure) {
      const { transactionHash } = result.failure;
      const count = (attempts.get(transactionHash) ?? 0) + 1;
      if (count >= MAX_ATTEMPTS) {
        await recordSkipped(SCAN, result.failure);
        skipped.add(transactionHash);
        attempts.delete(transactionHash);
        continue;
      }
      attempts.set(transactionHash, count);
      logger.warn('Internal transactions: could not trace a transaction; retrying later', {
        ...result.failure,
        attempt: count,
      });
      total.pending = result.failure;
      break;
    }
  }
  return total;
}

function contractRegistrar(): IndexToHeadOptions['onContractCreated'] {
  return (created) =>
    registerContract(
      created.address,
      created.creator,
      created.transactionHash,
      created.blockNumber
    );
}

async function printStatus(): Promise<void> {
  const marker = (await ScanProgress.findOne({ scanType: SCAN }).lean()) as Record<
    string,
    unknown
  > | null;
  const head = await dbHeadNumber();
  const documents = await InternalTransaction.estimatedDocumentCount();
  const skipped = (marker?.skipped as unknown[] | undefined) ?? [];
  console.log(
    JSON.stringify(
      {
        lastScannedBlock: marker?.lastScannedBlock ?? null,
        storedHead: head,
        behind:
          head !== null && typeof marker?.lastScannedBlock === 'number'
            ? head - marker.lastScannedBlock
            : null,
        inFlightTo: marker?.inFlightTo ?? null,
        generation: marker?.generation ?? null,
        documents,
        skipped,
      },
      null,
      1
    )
  );
}

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The indexer (follows the chain), or a one-off with a flag; the worker calls it with no arguments. */
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Internal transaction indexer

  npm run internal-txs                    # follow the chain
  npm run internal-txs -- --once          # index up to the confirmed head, then exit
  npm run internal-txs -- --from <block>  # start again at <block>
  npm run internal-txs -- --status        # marker, documents, skipped transactions
`);
    return;
  }

  await connectDB();
  if (mongoose.connection.readyState !== 1) throw new Error('database connection failed');
  if (args.includes('--status')) {
    await printStatus();
    return;
  }
  await ensureIndexesOnStartup('internal-txs');

  const fromArg = argValue(args, '--from');
  if (fromArg !== undefined) {
    const fromBlock = Number.parseInt(fromArg, 10);
    if (!Number.isSafeInteger(fromBlock) || fromBlock < 0)
      throw new Error('--from needs a block number');
    await resetRangeScan(SCAN, fromBlock);
    logger.info('Internal transactions: marker reset', { fromBlock });
  }

  const config = readConfig();
  const { confirmations } = resolveSyncSettings(config.sync);
  const concurrency = Number(config.traces?.concurrency) || 4;
  const once = args.includes('--once');
  const attempts = new Map<string, number>();
  const onContractCreated = contractRegistrar();

  for (;;) {
    const url = getTraceSourceUrl();
    if (!url) {
      logger.warn(
        'Internal transactions are not indexed: set traces.url in config.json or TRACE_RPC_URL'
      );
      if (once) return;
      await sleep(IDLE_MS);
      continue;
    }
    const source = createTraceSource(url);
    logger.info('Internal transaction indexer started', {
      source: describeTraceSource(url),
      confirmations,
      concurrency,
    });
    try {
      for (;;) {
        const started = Date.now();
        const result = await indexToConfirmedHead(source, {
          confirmations,
          concurrency,
          attempts,
          onContractCreated,
        });
        if (result.ranges > 0) {
          logger.info('Internal transactions indexed', {
            ...result,
            pending: result.pending?.transactionHash ?? null,
            seconds: Math.round((Date.now() - started) / 1000),
          });
        }
        if (once) return;
        await sleep(POLL_MS);
      }
    } catch (error) {
      logger.error('Internal transaction indexer failed; retrying', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (once) throw error;
      await sleep(RETRY_MS);
    } finally {
      source.close();
    }
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌', error instanceof Error ? error.message : error);
      process.exit(1);
    });
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}
