/**
 * Progress markers of the indexers that rewrite whole block ranges
 * (scan_progress 'internal-transactions' and 'erc1155').
 *
 * An indexer reads its marker, announces the range it works on (`inFlightTo`),
 * rewrites the range and then moves the marker on, all conditional on the
 * marker's `generation`. replaceBlock() (lib/sync/reorg.ts) bumps the
 * generation and rewinds the marker below the height it rewrote whenever that
 * height is at or below the marker or the announced range, so a range that was
 * read before a reorganisation is never recorded as done: the indexer reads the
 * marker again and goes over the heights once more. Blocks above the announced
 * range (the live head) leave the marker alone.
 */

import { ScanProgress } from '../../models/index';
import { logger } from '../logger';

export const RANGE_SCAN_TYPES = ['internal-transactions', 'erc1155'] as const;
export type RangeScanType = (typeof RANGE_SCAN_TYPES)[number];

export interface RangeScanState {
  /** Last block done; -1 before the first run. */
  lastScannedBlock: number;
  generation: number | null;
}

export interface SkippedTransaction {
  blockNumber: number;
  transactionHash: string;
  reason: string;
}

interface MarkerDoc {
  lastScannedBlock?: number;
  generation?: number | null;
  skipped?: Array<SkippedTransaction & { at?: Date }>;
}

const markers = () => ScanProgress.collection;

/** The marker, created at -1 when missing. */
export async function loadRangeScan(scanType: RangeScanType): Promise<RangeScanState> {
  await markers().updateOne(
    { scanType },
    { $setOnInsert: { lastScannedBlock: -1, lastUpdateTime: new Date(), meta: null } },
    { upsert: true }
  );
  const doc = (await markers().findOne({ scanType })) as MarkerDoc | null;
  return {
    lastScannedBlock: typeof doc?.lastScannedBlock === 'number' ? doc.lastScannedBlock : -1,
    generation: typeof doc?.generation === 'number' ? doc.generation : null,
  };
}

const unchanged = (scanType: RangeScanType, state: RangeScanState) => ({
  scanType,
  lastScannedBlock: state.lastScannedBlock,
  // equality with null also matches a marker that never had a generation
  generation: state.generation,
});

/** Announce that blocks up to `to` are being rewritten. False when the marker moved meanwhile. */
export async function claimRange(
  scanType: RangeScanType,
  state: RangeScanState,
  to: number
): Promise<boolean> {
  const result = await markers().updateOne(unchanged(scanType, state), {
    $set: { inFlightTo: to },
  });
  return result.matchedCount === 1;
}

/**
 * Record blocks up to `committedTo` as done and clear the announcement. False
 * when replaceBlock() touched the range meanwhile: nothing is recorded and the
 * caller starts again from the rewound marker.
 */
export async function completeRange(
  scanType: RangeScanType,
  state: RangeScanState,
  committedTo: number
): Promise<boolean> {
  const result = await markers().updateOne(unchanged(scanType, state), {
    $set: {
      lastScannedBlock: Math.max(committedTo, state.lastScannedBlock),
      inFlightTo: null,
      lastUpdateTime: new Date(),
    },
  });
  return result.matchedCount === 1;
}

/**
 * Called by replaceBlock() after it rewrote `height`: rewinds every range
 * marker that covers the height, or whose announced range does. Returns the
 * number of markers rewound.
 */
export async function rewindRangeScans(height: number): Promise<number> {
  const result = await markers().updateMany(
    {
      scanType: { $in: [...RANGE_SCAN_TYPES] },
      $or: [{ lastScannedBlock: { $gte: height } }, { inFlightTo: { $gte: height } }],
    },
    [
      {
        $set: {
          lastScannedBlock: { $min: ['$lastScannedBlock', height - 1] },
          generation: { $add: [{ $ifNull: ['$generation', 0] }, 1] },
          lastUpdateTime: '$$NOW',
        },
      },
    ]
  );
  return result.modifiedCount;
}

/** Start the next run at `fromBlock` (CLI `--from`). */
export async function resetRangeScan(scanType: RangeScanType, fromBlock: number): Promise<void> {
  await markers().updateOne(
    { scanType },
    [
      {
        $set: {
          lastScannedBlock: fromBlock - 1,
          inFlightTo: null,
          generation: { $add: [{ $ifNull: ['$generation', 0] }, 1] },
          lastUpdateTime: '$$NOW',
        },
      },
    ],
    { upsert: true }
  );
}

/** Transactions given up on so far (they count as having nothing to index). */
export async function loadSkipped(scanType: RangeScanType): Promise<Set<string>> {
  const doc = (await markers().findOne({ scanType })) as MarkerDoc | null;
  return new Set((doc?.skipped ?? []).map((entry) => entry.transactionHash));
}

/** Remember a transaction that was given up on (newest 100 are kept). */
export async function recordSkipped(
  scanType: RangeScanType,
  entry: SkippedTransaction
): Promise<void> {
  await ScanProgress.updateOne(
    { scanType },
    { $push: { skipped: { $each: [{ ...entry, at: new Date() }], $slice: -100 } } }
  );
  logger.error('Range scan: transaction skipped', { scanType, ...entry });
}
