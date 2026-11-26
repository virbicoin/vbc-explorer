/**
 * Uncle issuance per block (Block.uncleReward).
 *
 * Every block that includes uncles creates coins beyond its block reward: each
 * uncle's miner gets (uncle + 8 - block) / 8 of the block reward and the
 * including miner gets 1/32 of it per uncle (lib/reward-schedule.ts). The
 * amount depends on each uncle's height, which the block itself does not
 * carry, so it is looked up on the node and stored on the block document.
 * lib/supply.ts adds the stored amounts to the block-reward schedule.
 *
 * Writers: replaceBlock() (live sync, reorgs, repair) requires the lookup to
 * succeed; the bulk range sync stores the block without the field when a
 * lookup fails and `npm run backfill-uncle-rewards` fills it later.
 */

import { Block, ScanProgress } from '../../models/index';
import { logger } from '../logger';
import { getRewardSchedule } from '../config';
import { calculateUncleIssuanceWei, type RewardSchedule } from '../reward-schedule';
import { toHex, toNumber, type BlockDoc, type ChainNode, type RawBlock } from './normalize';

/** scan_progress entry written by the backfill. */
export const UNCLE_REWARD_SCAN = 'uncle-rewards';

/** keccak256(rlp([])): the sha3Uncles of a block without uncles. */
export const EMPTY_UNCLES_HASH =
  '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347';

/**
 * Wei created for the uncles of `raw` as a decimal string, or undefined when
 * the block has none. Throws when an uncle header is missing or does not match
 * the hash listed in the block, so an incomplete amount is never stored.
 */
export async function fetchUncleReward(
  node: Pick<ChainNode, 'getUncle'>,
  raw: Pick<RawBlock, 'number' | 'hash' | 'uncles'>,
  schedule: RewardSchedule = getRewardSchedule()
): Promise<string | undefined> {
  const expected = (raw.uncles ?? []).map(toHex);
  if (expected.length === 0) return undefined;

  const blockNumber = toNumber(raw.number);
  const blockHash = toHex(raw.hash);
  const uncleNumbers = await Promise.all(
    expected.map(async (hash, index) => {
      const uncle = await node.getUncle(blockHash, index);
      if (!uncle) throw new Error(`uncle ${index} of block ${blockNumber} not found`);
      if (toHex(uncle.hash) !== hash) {
        throw new Error(
          `uncle ${index} of block ${blockNumber} is ${toHex(uncle.hash)}, not ${hash}`
        );
      }
      return toNumber(uncle.number);
    })
  );
  return calculateUncleIssuanceWei(schedule, blockNumber, uncleNumbers).toString();
}

/**
 * Best-effort variant for the bulk sync: sets `doc.uncleReward`, or logs and
 * leaves it unset when the node lookup fails (the backfill picks the block up).
 */
export async function attachUncleReward(
  node: Pick<ChainNode, 'getUncle'>,
  raw: RawBlock,
  doc: BlockDoc
): Promise<BlockDoc> {
  try {
    const reward = await fetchUncleReward(node, raw);
    if (reward !== undefined) doc.uncleReward = reward;
  } catch (error) {
    logger.warn('Uncle reward lookup failed; run `npm run backfill-uncle-rewards`', {
      block: doc.number,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Backfill

interface StoredBlock {
  number: number;
  hash: string;
  uncles?: string[];
  sha3Uncles?: string;
  uncleReward?: string;
}

const hasUncles = (doc: StoredBlock): boolean =>
  (doc.uncles?.length ?? 0) > 0 ||
  (typeof doc.sha3Uncles === 'string' &&
    doc.sha3Uncles !== '' &&
    doc.sha3Uncles.toLowerCase() !== EMPTY_UNCLES_HASH);

export interface BackfillOptions {
  node: ChainNode;
  /** First height to scan (default: resume after the saved position, else 0). */
  from?: number;
  /** Last height to scan (default: the highest stored block). */
  to?: number;
  batchSize?: number;
  concurrency?: number;
  dryRun?: boolean;
  onBatch?: (summary: BackfillSummary) => void;
}

export interface BackfillSummary {
  from: number;
  to: number;
  /** Highest height scanned so far. */
  position: number;
  scanned: number;
  withUncles: number;
  alreadySet: number;
  /** Values written (or, with dryRun, values that would be written). */
  filled: number;
  /** Wei of the values filled by this run. */
  filledWei: string;
  failedCount: number;
  /** First failures (capped) with the reason. */
  failed: Array<{ number: number; error: string }>;
}

const MAX_REPORTED_FAILURES = 50;

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await task(items[next++]);
  });
  await Promise.all(workers);
}

/**
 * Fill Block.uncleReward for stored blocks with uncles that lack it.
 *
 * Each block is checked against the node first: a stored block that is not
 * the node's canonical block at its height (an orphan the repair tool has not
 * replaced yet) is reported as failed instead of being given the amount of a
 * non-canonical block. Writes match on number and hash, so a block replaced
 * by a reorg during the run is left alone. Progress is saved per batch in
 * scan_progress ('uncle-rewards').
 */
export async function backfillUncleRewards(options: BackfillOptions): Promise<BackfillSummary> {
  const { node, batchSize = 1000, concurrency = 8, dryRun = false } = options;

  const saved = (await ScanProgress.findOne({ scanType: UNCLE_REWARD_SCAN }).lean()) as {
    lastScannedBlock?: number;
  } | null;
  const from = options.from ?? (saved?.lastScannedBlock != null ? saved.lastScannedBlock + 1 : 0);
  const top = (await Block.findOne().sort({ number: -1 }).select('number').lean()) as {
    number?: number;
  } | null;
  const to = options.to ?? top?.number ?? -1;

  const summary: BackfillSummary = {
    from,
    to,
    position: from - 1,
    scanned: 0,
    withUncles: 0,
    alreadySet: 0,
    filled: 0,
    filledWei: '0',
    failedCount: 0,
    failed: [],
  };
  let filledWei = 0n;
  const fail = (number: number, error: unknown) => {
    summary.failedCount += 1;
    if (summary.failed.length < MAX_REPORTED_FAILURES) {
      summary.failed.push({
        number,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  while (summary.position < to) {
    const docs = (await Block.find({ number: { $gt: summary.position, $lte: to } })
      .select('number hash uncles sha3Uncles uncleReward')
      .sort({ number: 1 })
      .limit(batchSize)
      .lean()) as unknown as StoredBlock[];
    if (docs.length === 0) break;

    const targets: StoredBlock[] = [];
    for (const doc of docs) {
      if (!hasUncles(doc)) continue;
      summary.withUncles += 1;
      if (doc.uncleReward !== undefined && doc.uncleReward !== null) summary.alreadySet += 1;
      else targets.push(doc);
    }

    await mapWithConcurrency(targets, concurrency, async (doc) => {
      try {
        const header = await node.getBlockHeader(doc.number);
        if (!header || toHex(header.hash) !== toHex(doc.hash)) {
          throw new Error(
            'stored block is not the canonical block; run `npm run repair-chain -- --fix`'
          );
        }
        let uncles = doc.uncles ?? [];
        if (uncles.length === 0) {
          // sha3Uncles says there are uncles but the stored list is empty
          uncles = ((await node.getBlock(doc.number))?.uncles ?? []).map(toHex);
        }
        const reward = await fetchUncleReward(node, { number: doc.number, hash: doc.hash, uncles });
        if (reward === undefined) return;
        if (!dryRun) {
          const result = await Block.updateOne(
            { number: doc.number, hash: doc.hash },
            { $set: { uncleReward: reward } }
          );
          if (result.matchedCount === 0) throw new Error('block changed during the backfill');
        }
        summary.filled += 1;
        filledWei += BigInt(reward);
      } catch (error) {
        fail(doc.number, error);
      }
    });

    summary.scanned += docs.length;
    summary.position = docs[docs.length - 1].number;
    summary.filledWei = filledWei.toString();
    if (!dryRun) {
      await ScanProgress.updateOne(
        { scanType: UNCLE_REWARD_SCAN },
        {
          $set: {
            lastScannedBlock: summary.position,
            lastUpdateTime: new Date(),
            meta: { from, failedCount: summary.failedCount },
          },
        },
        { upsert: true }
      );
    }
    options.onBatch?.(summary);
  }

  summary.filledWei = filledWei.toString();
  return summary;
}
