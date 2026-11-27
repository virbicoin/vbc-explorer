/**
 * Reorg-aware block writes shared by tools/sync.ts (live listener) and
 * tools/repair-chain.ts (orphan repair).
 *
 * Principles:
 * - Blocks are upserted by `number`, transactions by `hash` (never insertMany,
 *   never "ignore E11000"): a transaction re-included in another block has its
 *   blockNumber / blockHash / transactionIndex / timestamp overwritten
 * - replaceBlock() swaps a height atomically enough for an explorer: delete
 *   the old block's transactions, their token transfers and internal
 *   transactions, upsert the block (with its uncle issuance,
 *   lib/sync/uncle-rewards.ts) and its canonical transactions, rewind the
 *   range indexers that covered the
 *   height (lib/sync/range-scan.ts), and log the event. Same hash → nothing is
 *   written.
 * - findCommonAncestor() walks back (at most maxDepth) to the last height
 *   where DB and node hashes agree; when none is found the range is recorded
 *   in scan_progress ('reorg-pending') for the repair tool.
 */

import {
  Block,
  InternalTransaction,
  Log,
  ScanProgress,
  Token,
  TokenTransfer,
  Transaction,
} from '../../models/index';
import { logger } from '../logger';
import {
  blockTransactionObjects,
  normalizeBlock,
  normalizeTransaction,
  toHex,
  type BlockDoc,
  type ChainNode,
  type RawBlock,
  type RawReceipt,
  type TransactionDoc,
} from './normalize';
import { fetchUncleReward } from './uncle-rewards';
import { rewindRangeScans } from './range-scan';

export const DEFAULT_CONFIRMATIONS = 12;
export const DEFAULT_MAX_REORG_DEPTH = 64;
const RECEIPT_CONCURRENCY = 5;

export interface SyncSettings {
  /** Heights below the head that are re-verified against the node on every poll. */
  confirmations: number;
  /** How far back a common ancestor is searched before giving up. */
  maxReorgDepth: number;
}

export interface ContractCreation {
  address: string;
  creator: string;
  transactionHash: string;
  blockNumber: number;
}

export interface ReorgDeps {
  /** Called for every contract-creating transaction written (sync registers the contract). */
  onContractCreated?: (creation: ContractCreation) => void | Promise<void>;
  quiet?: boolean;
}

export interface ReplaceBlockResult {
  height: number;
  replaced: boolean;
  oldHash: string | null;
  newHash: string;
  deletedTransactions: number;
  deletedTokenTransfers: number;
  deletedInternalTransactions: number;
  deletedLogs: number;
  addedTransactions: number;
  /** Range indexers (internal transactions, VRC-1155, logs) sent back below this height. */
  rewoundScans: number;
}

function parseIntSetting(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** CONFIRMATIONS / MAX_REORG_DEPTH: env (`SYNC_CONFIRMATIONS`, `SYNC_MAX_REORG_DEPTH`) > config.json `sync` > defaults. */
export function resolveSyncSettings(
  configSync: { confirmations?: unknown; maxReorgDepth?: unknown } | undefined,
  env: Record<string, string | undefined> = process.env
): SyncSettings {
  const fromConfig = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
  return {
    confirmations: parseIntSetting(
      env.SYNC_CONFIRMATIONS,
      fromConfig(configSync?.confirmations, DEFAULT_CONFIRMATIONS)
    ),
    maxReorgDepth: parseIntSetting(
      env.SYNC_MAX_REORG_DEPTH,
      fromConfig(configSync?.maxReorgDepth, DEFAULT_MAX_REORG_DEPTH)
    ),
  };
}

// ---------------------------------------------------------------------------
// Writes

export async function upsertBlocks(docs: BlockDoc[]): Promise<number> {
  if (docs.length === 0) return 0;
  const result = await Block.bulkWrite(
    docs.map((doc) => ({
      updateOne: {
        filter: { number: doc.number },
        // A block without uncles must not keep the uncle issuance of a block it replaced.
        // A block with uncles but no computed amount keeps the stored one (the backfill owns it).
        update:
          doc.uncles.length === 0 ? { $set: doc, $unset: { uncleReward: '' } } : { $set: doc },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  return result.upsertedCount + result.modifiedCount;
}

export async function upsertTransactions(docs: TransactionDoc[]): Promise<number> {
  if (docs.length === 0) return 0;
  const result = await Transaction.bulkWrite(
    docs.map((doc) => ({
      updateOne: { filter: { hash: doc.hash }, update: { $set: doc }, upsert: true },
    })),
    { ordered: false }
  );
  return result.upsertedCount + result.modifiedCount;
}

/** Receipts for a block's transactions (null for failed lookups), fetched in small parallel chunks. */
export async function fetchReceipts(
  node: ChainNode,
  hashes: string[]
): Promise<Map<string, RawReceipt | null>> {
  const receipts = new Map<string, RawReceipt | null>();
  for (let i = 0; i < hashes.length; i += RECEIPT_CONCURRENCY) {
    const chunk = hashes.slice(i, i + RECEIPT_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (hash) => {
        try {
          return await node.getTransactionReceipt(hash);
        } catch (error) {
          logger.warn('Receipt lookup failed', {
            hash,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      })
    );
    chunk.forEach((hash, index) => receipts.set(hash, results[index]));
  }
  return receipts;
}

/** Normalized block + transaction documents for a raw block (receipts fetched from the node). */
export async function buildBlockDocuments(
  node: ChainNode,
  raw: RawBlock,
  deps: ReorgDeps = {}
): Promise<{ block: BlockDoc; transactions: TransactionDoc[] }> {
  const block = normalizeBlock(raw);
  const txObjects = blockTransactionObjects(raw);
  const receipts = await fetchReceipts(
    node,
    txObjects.map((tx) => toHex(tx.hash))
  );
  const transactions: TransactionDoc[] = [];
  for (const tx of txObjects) {
    const hash = toHex(tx.hash);
    const receipt = receipts.get(hash) ?? null;
    const doc = normalizeTransaction(tx, receipt, raw);
    transactions.push(doc);
    if (doc.creates && doc.from && deps.onContractCreated) {
      try {
        await deps.onContractCreated({
          address: doc.creates,
          creator: doc.from,
          transactionHash: doc.hash,
          blockNumber: doc.blockNumber,
        });
      } catch (error) {
        logger.warn('Contract registration hook failed', {
          address: doc.creates,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { block, transactions };
}

/** Hashes stored on the DB block plus every Transaction document that points at the old block hash. */
async function oldTransactionHashes(oldBlock: { transactions?: string[] } | null, oldHash: string) {
  const hashes = new Set<string>((oldBlock?.transactions ?? []).map((h) => toHex(h)));
  const docs = await Transaction.find({ blockHash: oldHash }).select('hash').lean();
  for (const doc of docs as Array<{ hash?: string }>) if (doc.hash) hashes.add(toHex(doc.hash));
  return [...hashes];
}

/**
 * Make height `height` match `nodeBlock`. Removes the orphaned block's
 * transactions / token transfers, upserts the canonical block + transactions
 * and rewinds the token scan so transfers are re-indexed. No-op when the DB already holds the same hash.
 */
export async function replaceBlock(
  node: ChainNode,
  height: number,
  nodeBlock: RawBlock,
  deps: ReorgDeps = {}
): Promise<ReplaceBlockResult> {
  const newHash = toHex(nodeBlock.hash);
  const existing = (await Block.findOne({ number: height }).select('hash transactions').lean()) as {
    hash?: string;
    transactions?: string[];
  } | null;
  const oldHash = existing?.hash ? toHex(existing.hash) : null;

  if (oldHash === newHash) {
    return {
      height,
      replaced: false,
      oldHash,
      newHash,
      deletedTransactions: 0,
      deletedTokenTransfers: 0,
      deletedInternalTransactions: 0,
      deletedLogs: 0,
      addedTransactions: 0,
      rewoundScans: 0,
    };
  }

  // Before any delete: a failed uncle lookup must not leave the height half replaced.
  const uncleReward = await fetchUncleReward(node, nodeBlock);

  let deletedTransactions = 0;
  let deletedTokenTransfers = 0;
  let deletedInternalTransactions = 0;
  let deletedLogs = 0;
  if (oldHash) {
    const hashes = await oldTransactionHashes(existing, oldHash);
    if (hashes.length > 0) {
      const transfers = await TokenTransfer.deleteMany({ transactionHash: { $in: hashes } });
      deletedTokenTransfers = transfers.deletedCount ?? 0;
    }
    const internal = await InternalTransaction.deleteMany({
      $or: [
        { blockHash: oldHash },
        ...(hashes.length > 0 ? [{ transactionHash: { $in: hashes } }] : []),
      ],
    });
    deletedInternalTransactions = internal.deletedCount ?? 0;
    const logs = await Log.deleteMany({
      $or: [
        { blockHash: oldHash },
        ...(hashes.length > 0 ? [{ transactionHash: { $in: hashes } }] : []),
      ],
    });
    deletedLogs = logs.deletedCount ?? 0;
    const txs = await Transaction.deleteMany({ blockHash: oldHash });
    deletedTransactions = txs.deletedCount ?? 0;
    // Token scan must revisit this height for the transfers of the canonical block
    await ScanProgress.updateOne(
      { scanType: 'tokens', lastScannedBlock: { $gte: height } },
      { $set: { lastScannedBlock: height - 1, lastUpdateTime: new Date() } }
    );
  }

  const { block, transactions } = await buildBlockDocuments(node, nodeBlock, deps);
  if (uncleReward !== undefined) block.uncleReward = uncleReward;
  await upsertBlocks([block]);
  await upsertTransactions(transactions);
  // VRC-20 / LP tokens read their Transfer events again from the replaced height
  await Token.updateMany(
    { transfersScannedTo: { $gte: height } },
    { $set: { transfersScannedTo: height - 1 } }
  );
  // A height the range indexers already covered (a reorg, or a gap filled by repair-chain)
  // must be indexed again; the live head is above their ranges and leaves them alone
  const rewoundScans = await rewindRangeScans(height);

  const result: ReplaceBlockResult = {
    height,
    replaced: true,
    oldHash,
    newHash,
    deletedTransactions,
    deletedTokenTransfers,
    deletedInternalTransactions,
    deletedLogs,
    addedTransactions: transactions.length,
    rewoundScans,
  };
  if (oldHash) {
    logger.warn('Reorg: block replaced', { ...result });
  } else if (!deps.quiet) {
    logger.info('Block written', { height, hash: newHash, transactions: transactions.length });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Detection

/**
 * Highest height ≤ `fromHeight` (searching at most `maxDepth` heights down)
 * where the DB block hash equals the node's; null when none is found.
 */
export async function findCommonAncestor(
  node: ChainNode,
  fromHeight: number,
  maxDepth: number
): Promise<number | null> {
  const lowest = Math.max(0, fromHeight - maxDepth);
  const dbBlocks = (await Block.find({ number: { $gte: lowest, $lte: fromHeight } })
    .select('number hash')
    .lean()) as Array<{ number: number; hash?: string }>;
  const dbHashes = new Map(dbBlocks.map((b) => [b.number, toHex(b.hash ?? '')]));
  for (let h = fromHeight; h >= lowest; h--) {
    const dbHash = dbHashes.get(h);
    if (!dbHash) continue; // gap in the DB: cannot confirm this height, keep walking
    const header = await node.getBlockHeader(h);
    if (header && toHex(header.hash) === dbHash) return h;
  }
  return null;
}

/** Record a reorg the live sync could not resolve (deeper than maxReorgDepth) for tools/repair-chain.ts. */
export async function recordReorgPending(fromHeight: number, toHeight: number, reason: string) {
  await ScanProgress.updateOne(
    { scanType: 'reorg-pending' },
    {
      $set: {
        lastScannedBlock: toHeight,
        lastUpdateTime: new Date(),
        meta: { fromHeight, toHeight, reason },
      },
    },
    { upsert: true }
  );
}

export interface ReorgResult {
  resolved: boolean;
  ancestor: number | null;
  replaced: number[];
}

/**
 * The DB diverges from the node somewhere at or below `fromHeight`: find the
 * common ancestor and replace every height above it up to `fromHeight`.
 */
export async function handleReorg(
  node: ChainNode,
  fromHeight: number,
  settings: SyncSettings,
  deps: ReorgDeps = {}
): Promise<ReorgResult> {
  const ancestor = await findCommonAncestor(node, fromHeight, settings.maxReorgDepth);
  if (ancestor === null) {
    const lowest = Math.max(0, fromHeight - settings.maxReorgDepth);
    logger.error('Reorg deeper than maxReorgDepth; left for repair-chain', {
      fromHeight,
      searchedDownTo: lowest,
      maxReorgDepth: settings.maxReorgDepth,
    });
    await recordReorgPending(lowest, fromHeight, 'no common ancestor within maxReorgDepth');
    return { resolved: false, ancestor: null, replaced: [] };
  }

  const replaced: number[] = [];
  for (let h = ancestor + 1; h <= fromHeight; h++) {
    const nodeBlock = await node.getBlock(h);
    if (!nodeBlock) break;
    const result = await replaceBlock(node, h, nodeBlock, deps);
    if (result.replaced) replaced.push(h);
  }
  logger.warn('Reorg handled', {
    fromHeight,
    ancestor,
    depth: fromHeight - ancestor,
    replaced: replaced.length,
  });
  return { resolved: true, ancestor, replaced };
}

export type NewBlockStatus = 'missing' | 'unchanged' | 'inserted' | 'replaced';

export interface NewBlockResult {
  height: number;
  status: NewBlockStatus;
  reorg?: ReorgResult;
  transactions: number;
}

/**
 * Ingest height `height` from the node. If its parentHash does not match the
 * DB block below, a reorg is resolved first; a block that already exists with
 * a different hash is replaced, never skipped.
 */
export async function processNewBlock(
  node: ChainNode,
  height: number,
  settings: SyncSettings,
  deps: ReorgDeps = {}
): Promise<NewBlockResult> {
  const nodeBlock = await node.getBlock(height);
  if (!nodeBlock) return { height, status: 'missing', transactions: 0 };

  let reorg: ReorgResult | undefined;
  if (height > 0) {
    const parent = (await Block.findOne({ number: height - 1 })
      .select('hash')
      .lean()) as {
      hash?: string;
    } | null;
    if (parent?.hash && toHex(parent.hash) !== toHex(nodeBlock.parentHash)) {
      logger.warn('Reorg detected: parent hash mismatch', {
        height,
        dbParentHash: toHex(parent.hash),
        nodeParentHash: toHex(nodeBlock.parentHash),
      });
      reorg = await handleReorg(node, height - 1, settings, deps);
    }
  }

  const existing = (await Block.findOne({ number: height }).select('hash').lean()) as {
    hash?: string;
  } | null;
  if (existing?.hash && toHex(existing.hash) === toHex(nodeBlock.hash)) {
    return { height, status: 'unchanged', reorg, transactions: 0 };
  }
  const result = await replaceBlock(node, height, nodeBlock, deps);
  return {
    height,
    status: result.oldHash ? 'replaced' : 'inserted',
    reorg,
    transactions: result.addedTransactions,
  };
}

/**
 * Compare the DB hashes of `head - confirmations .. head` with the node and
 * replace every mismatch (catches reorgs that happened between polls).
 * Heights missing from the DB are left to the listener / backfill.
 */
export async function verifyConfirmationWindow(
  node: ChainNode,
  head: number,
  confirmations: number,
  deps: ReorgDeps = {}
): Promise<number[]> {
  const lowest = Math.max(0, head - confirmations);
  const dbBlocks = (await Block.find({ number: { $gte: lowest, $lte: head } })
    .select('number hash')
    .lean()) as Array<{ number: number; hash?: string }>;
  const replaced: number[] = [];
  for (const dbBlock of dbBlocks.sort((a, b) => a.number - b.number)) {
    const header = await node.getBlockHeader(dbBlock.number);
    if (!header) continue;
    if (toHex(header.hash) === toHex(dbBlock.hash ?? '')) continue;
    const nodeBlock = await node.getBlock(dbBlock.number);
    if (!nodeBlock) continue;
    const result = await replaceBlock(node, dbBlock.number, nodeBlock, deps);
    if (result.replaced) replaced.push(dbBlock.number);
  }
  if (replaced.length > 0) {
    logger.warn('Confirmation window: blocks replaced', { head, confirmations, replaced });
  }
  return replaced;
}

// ---------------------------------------------------------------------------
// Persistent listener state (scan_progress, scanType 'sync')

export async function loadSyncState(): Promise<number | null> {
  const doc = (await ScanProgress.findOne({ scanType: 'sync' }).lean()) as {
    lastScannedBlock?: number;
  } | null;
  return typeof doc?.lastScannedBlock === 'number' ? doc.lastScannedBlock : null;
}

export async function saveSyncState(lastProcessedBlock: number): Promise<void> {
  await ScanProgress.updateOne(
    { scanType: 'sync' },
    { $set: { lastScannedBlock: lastProcessedBlock, lastUpdateTime: new Date() } },
    { upsert: true }
  );
}

/** Highest block number stored in the DB, or null when empty. */
export async function dbHeadNumber(): Promise<number | null> {
  const doc = (await Block.findOne({}, { number: 1 }).sort({ number: -1 }).lean()) as {
    number?: number;
  } | null;
  return typeof doc?.number === 'number' ? doc.number : null;
}
