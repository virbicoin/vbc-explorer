/**
 * Chain integrity checks and orphan repair shared by tools/repair-chain.ts.
 *
 * - checkChain(): stream every stored block in ascending order (projection
 *   number/hash/parentHash) and count gaps in the numbering and heights whose
 *   successor's parentHash does not point at them (orphans)
 * - sampleAgainstNode(): compare k random stored heights with the node
 * - repairChain(): for each broken link, walk back to the last height where
 *   DB and node agree and replace every height above it with the node's block
 *   until the chain reconnects (replaceBlock from ./reorg); resumable through
 *   scan_progress ('repair')
 */

import { Block, ScanProgress } from '../../models/index';
import { logger } from '../logger';
import { toHex, type ChainNode } from './normalize';
import { findCommonAncestor, replaceBlock, type ReorgDeps } from './reorg';

export interface ChainCheckOptions {
  from?: number;
  to?: number;
  batchSize?: number;
  /** How many example heights to keep (default 20). */
  maxExamples?: number;
  onProgress?: (scanned: number, height: number) => void;
}

export interface ChainCheckResult {
  scanned: number;
  first: number | null;
  last: number | null;
  /** Missing block numbers between the first and last stored block. */
  gaps: number;
  gapRanges: Array<[number, number]>;
  /** Heights h where Block[h+1].parentHash !== Block[h].hash. */
  mismatches: number;
  mismatchHeights: number[];
}

interface LeanHeader {
  number: number;
  hash?: string;
  parentHash?: string;
}

export async function checkChain(options: ChainCheckOptions = {}): Promise<ChainCheckResult> {
  const maxExamples = options.maxExamples ?? 20;
  const filter: Record<string, unknown> = {};
  if (options.from !== undefined || options.to !== undefined) {
    const range: Record<string, number> = {};
    if (options.from !== undefined) range.$gte = options.from;
    if (options.to !== undefined) range.$lte = options.to;
    filter.number = range;
  }

  const result: ChainCheckResult = {
    scanned: 0,
    first: null,
    last: null,
    gaps: 0,
    gapRanges: [],
    mismatches: 0,
    mismatchHeights: [],
  };

  const cursor = Block.find(filter, { number: 1, hash: 1, parentHash: 1, _id: 0 })
    .sort({ number: 1 })
    .lean()
    .cursor({ batchSize: options.batchSize ?? 5000 });

  let prev: LeanHeader | null = null;
  for await (const raw of cursor) {
    const doc = raw as LeanHeader;
    result.scanned += 1;
    if (result.first === null) result.first = doc.number;
    result.last = doc.number;
    if (prev) {
      if (doc.number !== prev.number + 1) {
        result.gaps += doc.number - prev.number - 1;
        if (result.gapRanges.length < maxExamples) {
          result.gapRanges.push([prev.number + 1, doc.number - 1]);
        }
      } else if (toHex(doc.parentHash ?? '') !== toHex(prev.hash ?? '')) {
        result.mismatches += 1;
        if (result.mismatchHeights.length < maxExamples) result.mismatchHeights.push(prev.number);
      }
    }
    prev = doc;
    if (options.onProgress && result.scanned % 100_000 === 0) {
      options.onProgress(result.scanned, doc.number);
    }
  }
  return result;
}

export interface SampleResult {
  requested: number;
  checked: number;
  missingInDb: number;
  mismatches: number;
  examples: Array<{ height: number; dbHash: string; nodeHash: string | null }>;
}

/** Compare `k` random stored heights (0..DB head) with the node's block hashes. */
export async function sampleAgainstNode(
  node: ChainNode,
  k: number,
  options: { maxExamples?: number; random?: () => number } = {}
): Promise<SampleResult> {
  const random = options.random ?? Math.random;
  const maxExamples = options.maxExamples ?? 20;
  const head = (await Block.findOne({}, { number: 1, _id: 0 }).sort({ number: -1 }).lean()) as {
    number?: number;
  } | null;
  const result: SampleResult = {
    requested: k,
    checked: 0,
    missingInDb: 0,
    mismatches: 0,
    examples: [],
  };
  if (!head || typeof head.number !== 'number') return result;

  const heights = new Set<number>();
  const universe = head.number + 1;
  const wanted = Math.min(k, universe);
  while (heights.size < wanted) heights.add(Math.floor(random() * universe));
  const list = [...heights].sort((a, b) => a - b);

  const docs = (await Block.find(
    { number: { $in: list } },
    { number: 1, hash: 1, _id: 0 }
  ).lean()) as LeanHeader[];
  const dbHashes = new Map(docs.map((d) => [d.number, toHex(d.hash ?? '')]));

  for (const height of list) {
    const dbHash = dbHashes.get(height);
    if (dbHash === undefined) {
      result.missingInDb += 1;
      continue;
    }
    const header = await node.getBlockHeader(height);
    result.checked += 1;
    const nodeHash = header ? toHex(header.hash) : null;
    if (nodeHash !== dbHash) {
      result.mismatches += 1;
      if (result.examples.length < maxExamples) result.examples.push({ height, dbHash, nodeHash });
    }
  }
  return result;
}

export interface RepairOptions {
  from?: number;
  to?: number;
  dryRun?: boolean;
  /** Common-ancestor search depth per site (default 64). */
  maxDepth?: number;
  /** Replacement cap per broken link (default 256). */
  maxReplacePerSite?: number;
  deps?: ReorgDeps;
  onProgress?: (processedSites: number, totalSites: number, height: number) => void;
  /** Resume from scan_progress ('repair') when `from` is not given (default true). */
  resume?: boolean;
}

export interface RepairResult {
  dryRun: boolean;
  sites: number;
  processedSites: number;
  /** Heights replaced (or planned in dry-run). */
  replaced: number[];
  planned: Array<{ height: number; oldHash: string | null; newHash: string }>;
  skippedSites: Array<{ height: number; reason: string }>;
  capReached: number[];
  deletedTransactions: number;
  addedTransactions: number;
  deletedTokenTransfers: number;
  minReplaced: number | null;
  maxReplaced: number | null;
  /** checkChain() after the repair (not run in dry-run). */
  verification: ChainCheckResult | null;
}

export const REPAIR_SCAN_TYPE = 'repair';

export async function loadRepairProgress(): Promise<number | null> {
  const doc = (await ScanProgress.findOne({ scanType: REPAIR_SCAN_TYPE }).lean()) as {
    lastScannedBlock?: number;
  } | null;
  return typeof doc?.lastScannedBlock === 'number' ? doc.lastScannedBlock : null;
}

async function saveRepairProgress(height: number): Promise<void> {
  await ScanProgress.updateOne(
    { scanType: REPAIR_SCAN_TYPE },
    { $set: { lastScannedBlock: height, lastUpdateTime: new Date() } },
    { upsert: true }
  );
}

/**
 * Replace orphaned blocks with the node's canonical blocks. Sites are the
 * heights reported by checkChain(); each is repaired from the common ancestor
 * upward until DB and node agree again.
 */
export async function repairChain(
  node: ChainNode,
  options: RepairOptions = {}
): Promise<RepairResult> {
  const dryRun = options.dryRun === true;
  const maxDepth = options.maxDepth ?? 64;
  const maxReplacePerSite = options.maxReplacePerSite ?? 256;
  let from = options.from;
  if (from === undefined && options.resume !== false) {
    const saved = await loadRepairProgress();
    if (saved !== null) from = saved + 1;
  }

  const scan = await checkChain({ from, to: options.to, maxExamples: Number.MAX_SAFE_INTEGER });
  const sites = scan.mismatchHeights;
  const result: RepairResult = {
    dryRun,
    sites: sites.length,
    processedSites: 0,
    replaced: [],
    planned: [],
    skippedSites: [],
    capReached: [],
    deletedTransactions: 0,
    addedTransactions: 0,
    deletedTokenTransfers: 0,
    minReplaced: null,
    maxReplaced: null,
    verification: null,
  };

  let repairedUpTo = -1;
  for (const site of sites) {
    result.processedSites += 1;
    if (site <= repairedUpTo) continue; // covered by the previous site's repair

    const ancestor = await findCommonAncestor(node, site, maxDepth);
    if (ancestor === null) {
      result.skippedSites.push({ height: site, reason: `no common ancestor within ${maxDepth}` });
      logger.error('repair-chain: no common ancestor', { site, maxDepth });
      continue;
    }

    let height = ancestor + 1;
    let count = 0;
    while (count < maxReplacePerSite) {
      const header = await node.getBlockHeader(height);
      if (!header) break; // node has nothing at this height
      const stored = (await Block.findOne({ number: height }, { hash: 1, _id: 0 }).lean()) as {
        hash?: string;
      } | null;
      if (stored?.hash && toHex(stored.hash) === toHex(header.hash)) break; // chain reconnected

      if (dryRun) {
        result.planned.push({
          height,
          oldHash: stored?.hash ? toHex(stored.hash) : null,
          newHash: toHex(header.hash),
        });
      } else {
        const nodeBlock = await node.getBlock(height);
        if (!nodeBlock) break;
        const replaced = await replaceBlock(node, height, nodeBlock, options.deps);
        result.deletedTransactions += replaced.deletedTransactions;
        result.addedTransactions += replaced.addedTransactions;
        result.deletedTokenTransfers += replaced.deletedTokenTransfers;
      }
      result.replaced.push(height);
      result.minReplaced =
        result.minReplaced === null ? height : Math.min(result.minReplaced, height);
      result.maxReplaced =
        result.maxReplaced === null ? height : Math.max(result.maxReplaced, height);
      count += 1;
      height += 1;
    }
    if (count >= maxReplacePerSite) {
      result.capReached.push(site);
      logger.warn('repair-chain: replacement cap reached, moving on', {
        site,
        ancestor,
        cap: maxReplacePerSite,
      });
    }
    repairedUpTo = height - 1;
    if (!dryRun) await saveRepairProgress(site);
    if (options.onProgress && result.processedSites % 1000 === 0) {
      options.onProgress(result.processedSites, sites.length, site);
    }
  }

  if (!dryRun) {
    result.verification = await checkChain({ from: options.from, to: options.to });
    if (result.verification.mismatches === 0) {
      await ScanProgress.deleteOne({ scanType: REPAIR_SCAN_TYPE });
    }
  }
  return result;
}
