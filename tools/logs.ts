#!/usr/bin/env node
/**
 * Event log indexer (worker job `logs`).
 *
 * Reads the receipt of every stored transaction from the node and keeps `Log` in step with
 * the chain (lib/sync/logs.ts). Like the internal transaction indexer it follows the confirmed
 * part of the chain only (the stored head minus `sync.confirmations`); deeper reorganisations
 * rewind its marker (lib/sync/range-scan.ts) and the heights are indexed again.
 *
 * Usage:
 *   npm run logs                    # follow the chain
 *   npm run logs -- --once          # index up to the confirmed head, then exit
 *   npm run logs -- --from <block>  # start again at <block> (combine with --once)
 *   npm run logs -- --status        # marker, documents, skipped transactions
 */

import '../lib/env'; // .env / .env.local before any other module reads process.env
import mongoose from 'mongoose';
import { connectDB, ensureIndexesOnStartup, Log, ScanProgress } from '../models/index';
import { readConfig } from '../lib/config';
import { logger } from '../lib/logger';
import { indexLogs, nodeReceipts, type ReceiptSource } from '../lib/sync/logs';
import {
  claimRange,
  completeRange,
  loadRangeScan,
  loadSkipped,
  recordSkipped,
  resetRangeScan,
  type SkippedTransaction,
} from '../lib/sync/range-scan';
import { dbHeadNumber, resolveSyncSettings } from '../lib/sync/reorg';

const SCAN = 'logs' as const;
const POLL_MS = 15_000;
const RETRY_MS = 60_000;
const RANGE_BLOCKS = 20_000;
/** Cycles a transaction may lack a usable receipt before it is skipped (and recorded). */
const MAX_ATTEMPTS = 3;

export interface IndexLogsToHeadResult {
  ranges: number;
  transactions: number;
  logs: number;
  lastScannedBlock: number;
  /** The transaction that stopped this run (it is retried on the next one). */
  pending: SkippedTransaction | null;
}

export interface IndexLogsToHeadOptions {
  confirmations: number;
  concurrency?: number;
  /** Failed attempts per transaction hash, kept across runs by the caller. */
  attempts?: Map<string, number>;
  /** Stop after this many ranges (tests). */
  maxRanges?: number;
}

/**
 * Index the logs of every stored transaction up to the confirmed head
 * (stored head − confirmations − 1). Connection errors are thrown.
 */
export async function indexLogsToConfirmedHead(
  source: ReceiptSource,
  options: IndexLogsToHeadOptions
): Promise<IndexLogsToHeadResult> {
  const attempts = options.attempts ?? new Map<string, number>();
  const skipped = await loadSkipped(SCAN);
  const total: IndexLogsToHeadResult = {
    ranges: 0,
    transactions: 0,
    logs: 0,
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

    const result = await indexLogs(source, from, to, {
      concurrency: options.concurrency,
      skip: skipped,
    });
    if (!(await completeRange(SCAN, state, result.committedTo))) {
      logger.warn('Logs: a reorganisation touched the range; indexing it again', { from, to });
      continue;
    }
    total.ranges++;
    total.transactions += result.transactions;
    total.logs += result.logs;
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
      logger.warn('Logs: no usable receipt for a transaction; retrying later', {
        ...result.failure,
        attempt: count,
      });
      total.pending = result.failure;
      break;
    }
  }
  return total;
}

async function printStatus(): Promise<void> {
  const marker = (await ScanProgress.findOne({ scanType: SCAN }).lean()) as Record<
    string,
    unknown
  > | null;
  const head = await dbHeadNumber();
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
        documents: await Log.estimatedDocumentCount(),
        skipped: (marker?.skipped as unknown[] | undefined) ?? [],
      },
      null,
      1
    )
  );
}

function argValue(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Event log indexer

  npm run logs                    # follow the chain
  npm run logs -- --once          # index up to the confirmed head, then exit
  npm run logs -- --from <block>  # start again at <block>
  npm run logs -- --status        # marker, documents, skipped transactions
`);
    return;
  }

  await connectDB();
  if (mongoose.connection.readyState !== 1) throw new Error('database connection failed');
  if (args.includes('--status')) {
    await printStatus();
    return;
  }
  await ensureIndexesOnStartup('logs');

  const fromArg = argValue(args, '--from');
  if (fromArg !== undefined) {
    const fromBlock = Number.parseInt(fromArg, 10);
    if (!Number.isSafeInteger(fromBlock) || fromBlock < 0)
      throw new Error('--from needs a block number');
    await resetRangeScan(SCAN, fromBlock);
    logger.info('Logs: marker reset', { fromBlock });
  }

  const { confirmations } = resolveSyncSettings(readConfig().sync);
  const once = args.includes('--once');
  const attempts = new Map<string, number>();
  const source = nodeReceipts();
  logger.info('Log indexer started', { confirmations });

  for (;;) {
    try {
      const started = Date.now();
      const result = await indexLogsToConfirmedHead(source, {
        confirmations,
        concurrency: 8,
        attempts,
      });
      if (result.ranges > 0) {
        logger.info('Logs indexed', {
          ...result,
          pending: result.pending?.transactionHash ?? null,
          seconds: Math.round((Date.now() - started) / 1000),
        });
      }
      if (once) return;
      await sleep(POLL_MS);
    } catch (error) {
      logger.error('Log indexer failed; retrying', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (once) throw error;
      await sleep(RETRY_MS);
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
