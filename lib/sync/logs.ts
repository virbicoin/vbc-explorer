/**
 * Event logs (`Log`) of the stored transactions, from the node's receipts.
 *
 * A range indexer like the internal transactions (scan_progress 'logs', lib/sync/range-scan.ts):
 * tools/logs.ts rewrites whole block ranges below the confirmed head, and replaceBlock()
 * (lib/sync/reorg.ts) deletes the logs of a block it replaces and rewinds the marker. A range
 * is written only from receipts in the block the transaction is stored in.
 */

import type { Hash } from 'viem';
import { Log } from '../../models/index';
import { getClient } from '../web3/provider';
import { toNumber } from './normalize';
import {
  blockTimes,
  loadRangeTransactions,
  type SkippedTransaction,
  type StoredTransaction,
} from './range-scan';

export interface LogDoc {
  address: string;
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
  topics: string[];
  data: string;
  timestamp: number;
}

/** A receipt as the node answers `eth_getTransactionReceipt` (hex quantities). */
export interface RawReceipt {
  transactionHash: string;
  transactionIndex?: string | number;
  blockHash: string;
  blockNumber?: string | number;
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
    logIndex: string | number;
  }>;
}

export interface ReceiptSource {
  receipt(hash: string): Promise<RawReceipt | null>;
}

/** Receipts from the node the explorer reads (getClient()). */
export function nodeReceipts(): ReceiptSource {
  return {
    receipt: async (hash) =>
      (await getClient().request({
        method: 'eth_getTransactionReceipt',
        params: [hash as Hash],
      })) as unknown as RawReceipt | null,
  };
}

const lower = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : '');

/** The documents of a receipt's logs; block, position and time come from the stored transaction. */
export function logsFromReceipt(
  receipt: RawReceipt,
  row: Pick<StoredTransaction, 'blockNumber' | 'blockHash' | 'transactionIndex'> & {
    timestamp: number;
  }
): LogDoc[] {
  return (receipt.logs ?? []).map((log) => ({
    address: lower(log.address),
    blockNumber: row.blockNumber,
    blockHash: lower(row.blockHash) || lower(receipt.blockHash),
    transactionHash: lower(receipt.transactionHash),
    transactionIndex: Number(row.transactionIndex ?? toNumber(receipt.transactionIndex)),
    logIndex: toNumber(log.logIndex),
    topics: (log.topics ?? []).map(lower),
    data: typeof log.data === 'string' ? log.data : '0x',
    timestamp: row.timestamp,
  }));
}

export interface IndexLogsOptions {
  concurrency?: number;
  /** Transactions per range at most (whole blocks); default 500. */
  maxTransactions?: number;
  /** Transactions given up on: they count as having no logs. */
  skip?: Set<string>;
}

export interface IndexLogsResult {
  from: number;
  /** Last block written; below `from` when nothing was. */
  committedTo: number;
  transactions: number;
  logs: number;
  /** The first transaction without a usable receipt; blocks from its block on are not written. */
  failure: SkippedTransaction | null;
}

/**
 * Read the receipts of the stored transactions of blocks [from, to] and replace the range's
 * logs. Only whole blocks below the first transaction without a usable receipt (unknown to the
 * node, or in another block than the stored one) are written. Connection errors are thrown.
 */
export async function indexLogs(
  source: ReceiptSource,
  from: number,
  to: number,
  options: IndexLogsOptions = {}
): Promise<IndexLogsResult> {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const { rows, to: rangeEnd } = await loadRangeTransactions(
    from,
    to,
    Math.max(1, options.maxTransactions ?? 500)
  );
  const missingTimes = await blockTimes([
    ...new Set(rows.filter((row) => !row.timestamp).map((row) => row.blockNumber)),
  ]);

  const found = new Map<string, LogDoc[]>();
  let failure: SkippedTransaction | null = null;
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
        found.set(hash, []);
        continue;
      }
      const receipt = await source.receipt(hash);
      if (!receipt) {
        fail(row, 'the node has no receipt for this transaction');
        continue;
      }
      if (lower(receipt.transactionHash) !== hash) {
        fail(row, 'the receipt belongs to another transaction');
        continue;
      }
      const stored = lower(row.blockHash);
      if (stored && lower(receipt.blockHash) && stored !== lower(receipt.blockHash)) {
        fail(row, `stored in block ${stored}, receipt in block ${lower(receipt.blockHash)}`);
        continue;
      }
      found.set(
        hash,
        logsFromReceipt(receipt, {
          ...row,
          timestamp: Number(row.timestamp) || missingTimes.get(row.blockNumber) || 0,
        })
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length || 1) }, worker));

  const failedAt = (failure as SkippedTransaction | null)?.blockNumber;
  const committedTo = failedAt !== undefined ? failedAt - 1 : rangeEnd;
  const committed = rows.filter((row) => row.blockNumber <= committedTo);
  const docs = committed.flatMap((row) => found.get(row.hash.toLowerCase()) ?? []);

  if (committedTo >= from) {
    const hashes = committed.map((row) => row.hash.toLowerCase());
    // the range is rewritten as a whole: logs of transactions that left it go too
    await Log.collection.deleteMany({
      $or: [
        { blockNumber: { $gte: from, $lte: committedTo } },
        ...(hashes.length > 0 ? [{ transactionHash: { $in: hashes } }] : []),
      ],
    });
    for (let start = 0; start < docs.length; start += 1000) {
      await Log.collection.insertMany(docs.slice(start, start + 1000), { ordered: false });
    }
  }

  return { from, committedTo, transactions: committed.length, logs: docs.length, failure };
}
