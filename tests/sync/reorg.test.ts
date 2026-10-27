/**
 * Reorg handling (lib/sync/reorg.ts) against mongodb-memory-server with a
 * fake node that serves the canonical chain.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Block, BlockStat, ScanProgress, TokenTransfer, Transaction } from '@/models/index';
import {
  findCommonAncestor,
  normalizeBlock,
  normalizeTransaction,
  processNewBlock,
  replaceBlock,
  resolveSyncSettings,
  upsertBlocks,
  upsertTransactions,
  verifyConfirmationWindow,
  type ChainNode,
  type RawBlock,
  type RawReceipt,
  type RawTransaction,
  type SyncSettings,
} from '@/lib/sync';

let mongod: MongoMemoryServer;

const hashOf = (label: string, n: number) =>
  `0x${label}${String(n).padStart(4, '0')}`.padEnd(66, '0');

type TestBlock = RawBlock & { number: number; hash: string; parentHash: string };

function tx(hash: string, block: TestBlock, index = 0): RawTransaction {
  return {
    hash,
    blockHash: block.hash,
    blockNumber: block.number,
    transactionIndex: index,
    from: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    value: '1000',
    gas: 21000,
    gasPrice: '1',
    input: '0x',
    nonce: index,
  };
}

function block(
  number: number,
  label: string,
  parentHash: string,
  txHashes: string[] = []
): TestBlock {
  const b: TestBlock = {
    number,
    hash: hashOf(label, number),
    parentHash,
    miner: '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    timestamp: 1_700_000_000 + number * 12,
    gasLimit: 8_000_000,
    gasUsed: 21_000 * txHashes.length,
    difficulty: '1',
    totalDifficulty: String(number),
    size: 500,
    nonce: '0x0',
    transactions: [],
    uncles: [],
  };
  b.transactions = txHashes.map((h, i) => tx(h, b, i));
  return b;
}

/** Canonical chain 0..n (label `can`). */
function canonicalChain(n: number, txAt: Record<number, string[]> = {}): TestBlock[] {
  const blocks: TestBlock[] = [];
  for (let i = 0; i <= n; i++) {
    const parent = i === 0 ? '0x' + '0'.repeat(64) : blocks[i - 1].hash;
    blocks.push(block(i, 'can', parent, txAt[i] ?? []));
  }
  return blocks;
}

class FakeNode implements ChainNode {
  blocks = new Map<number, RawBlock>();
  receipts = new Map<string, RawReceipt>();
  headerCalls = 0;
  constructor(chain: TestBlock[]) {
    for (const b of chain) this.blocks.set(b.number, b);
  }
  async getBlockNumber() {
    return Math.max(...this.blocks.keys());
  }
  async getBlock(height: number) {
    return this.blocks.get(height) ?? null;
  }
  async getBlockHeader(height: number) {
    this.headerCalls += 1;
    const b = this.blocks.get(height);
    return b ? { number: height, hash: String(b.hash), parentHash: String(b.parentHash) } : null;
  }
  async getTransactionReceipt(hash: string) {
    return this.receipts.get(hash) ?? { status: 1, gasUsed: 21000, contractAddress: null };
  }
}

async function seed(blocks: RawBlock[]) {
  await upsertBlocks(blocks.map(normalizeBlock));
  const txs = blocks.flatMap((b) =>
    (b.transactions ?? [])
      .filter((t): t is RawTransaction => typeof t === 'object')
      .map((t) => normalizeTransaction(t, { status: 1, gasUsed: 21000 }, b))
  );
  await upsertTransactions(txs);
}

async function dbHash(height: number) {
  const doc = (await Block.findOne({ number: height }).lean()) as { hash?: string } | null;
  return doc?.hash ?? null;
}

const settings: SyncSettings = { confirmations: 12, maxReorgDepth: 64 };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('explorerDB_reorg'), {
    autoIndex: false,
    autoCreate: false,
  });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
});

describe('resolveSyncSettings', () => {
  it('prefers env over config over defaults', () => {
    expect(resolveSyncSettings(undefined, {})).toEqual({ confirmations: 12, maxReorgDepth: 64 });
    expect(resolveSyncSettings({ confirmations: 20, maxReorgDepth: 10 }, {})).toEqual({
      confirmations: 20,
      maxReorgDepth: 10,
    });
    expect(
      resolveSyncSettings(
        { confirmations: 20 },
        { SYNC_CONFIRMATIONS: '6', SYNC_MAX_REORG_DEPTH: 'x' }
      )
    ).toEqual({
      confirmations: 6,
      maxReorgDepth: 64,
    });
  });
});

describe('upserts', () => {
  it('writes blocks by number and transactions by hash idempotently', async () => {
    const chain = canonicalChain(2, { 1: ['0xt1'] });
    await seed(chain);
    await seed(chain);
    expect(await Block.countDocuments({})).toBe(3);
    expect(await Transaction.countDocuments({})).toBe(1);
    const doc = (await Transaction.findOne({ hash: '0xt1' }).lean()) as {
      from?: string;
      blockNumber?: number;
    };
    expect(doc.from).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'); // lowercased
    expect(doc.blockNumber).toBe(1);
  });
});

describe('processNewBlock', () => {
  it('(a) replaces a depth-1 orphan when the new block does not build on it', async () => {
    const canonical = canonicalChain(11, { 10: ['0xcan10tx'] });
    const orphan10 = block(10, 'orp', canonical[9].hash, ['0xorphantx']);
    await seed([...canonical.slice(0, 10), orphan10]);
    await TokenTransfer.collection.insertOne({
      transactionHash: '0xorphantx',
      tokenAddress: '0xt',
      blockNumber: 10,
    });
    await BlockStat.collection.insertOne({ number: 10, timestamp: 1 });
    await ScanProgress.collection.insertOne({ scanType: 'tokens', lastScannedBlock: 500 });

    const node = new FakeNode(canonical);
    const result = await processNewBlock(node, 11, settings);

    expect(result.status).toBe('inserted');
    expect(result.reorg).toMatchObject({ resolved: true, ancestor: 9, replaced: [10] });
    expect(await dbHash(10)).toBe(canonical[10].hash);
    expect(await dbHash(11)).toBe(canonical[11].hash);
    expect(await Transaction.countDocuments({ hash: '0xorphantx' })).toBe(0);
    expect(await Transaction.countDocuments({ hash: '0xcan10tx' })).toBe(1);
    expect(await TokenTransfer.countDocuments({})).toBe(0);
    expect(await BlockStat.countDocuments({ number: 10 })).toBe(0);
    const scan = (await ScanProgress.findOne({ scanType: 'tokens' }).lean()) as {
      lastScannedBlock: number;
    };
    expect(scan.lastScannedBlock).toBe(9);
  });

  it('(b) resolves a depth-3 reorg back to the common ancestor', async () => {
    const canonical = canonicalChain(11);
    const orp8 = block(8, 'orp', canonical[7].hash, ['0xo8']);
    const orp9 = block(9, 'orp', orp8.hash, ['0xo9']);
    const orp10 = block(10, 'orp', orp9.hash, ['0xo10']);
    await seed([...canonical.slice(0, 8), orp8, orp9, orp10]);

    const node = new FakeNode(canonical);
    const result = await processNewBlock(node, 11, settings);

    expect(result.reorg).toMatchObject({ resolved: true, ancestor: 7, replaced: [8, 9, 10] });
    for (const h of [8, 9, 10, 11]) expect(await dbHash(h)).toBe(canonical[h].hash);
    expect(await Transaction.countDocuments({ hash: { $in: ['0xo8', '0xo9', '0xo10'] } })).toBe(0);
    expect(await ScanProgress.countDocuments({ scanType: 'reorg-pending' })).toBe(0);
  });

  it('(c) records reorg-pending when the fork is deeper than maxReorgDepth', async () => {
    const canonical = canonicalChain(11);
    const orp8 = block(8, 'orp', canonical[7].hash);
    const orp9 = block(9, 'orp', orp8.hash);
    const orp10 = block(10, 'orp', orp9.hash);
    await seed([...canonical.slice(0, 8), orp8, orp9, orp10]);

    const node = new FakeNode(canonical);
    const result = await processNewBlock(node, 11, { confirmations: 12, maxReorgDepth: 2 });

    expect(result.reorg).toMatchObject({ resolved: false, ancestor: null, replaced: [] });
    expect(result.status).toBe('inserted'); // the tip itself is still written
    const pending = (await ScanProgress.findOne({ scanType: 'reorg-pending' }).lean()) as {
      lastScannedBlock: number;
      meta: { fromHeight: number; toHeight: number };
    };
    expect(pending.lastScannedBlock).toBe(10);
    expect(pending.meta).toMatchObject({ fromHeight: 8, toHeight: 10 });
    expect(await dbHash(10)).toBe(orp10.hash); // untouched: left for repair-chain
  });

  it('(d) a transaction that moves from N to N+1 ends up once, on the canonical side', async () => {
    const canonical = canonicalChain(11, { 11: ['0xmoved'] });
    const orphan10 = block(10, 'orp', canonical[9].hash, ['0xmoved']);
    await seed([...canonical.slice(0, 10), orphan10]);
    expect(
      ((await Transaction.findOne({ hash: '0xmoved' }).lean()) as { blockNumber: number })
        .blockNumber
    ).toBe(10);

    const node = new FakeNode(canonical);
    await processNewBlock(node, 11, settings);

    const docs = (await Transaction.find({ hash: '0xmoved' }).lean()) as Array<{
      blockNumber: number;
      blockHash: string;
    }>;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ blockNumber: 11, blockHash: canonical[11].hash });
  });

  it('(e) same hash: nothing is written', async () => {
    const canonical = canonicalChain(10, { 10: ['0xa'] });
    await seed(canonical);
    const before = (await Block.findOne({ number: 10 }).lean()) as { _id: unknown };
    const node = new FakeNode(canonical);

    expect((await processNewBlock(node, 10, settings)).status).toBe('unchanged');
    const direct = await replaceBlock(node, 10, canonical[10]);
    expect(direct).toMatchObject({
      replaced: false,
      oldHash: canonical[10].hash,
      newHash: canonical[10].hash,
      addedTransactions: 0,
    });
    expect(await Transaction.countDocuments({})).toBe(1);
    const after = (await Block.findOne({ number: 10 }).lean()) as { _id: unknown };
    expect(String(after._id)).toBe(String(before._id));
  });

  it('inserts a brand-new height without a reorg check when the parent is unknown', async () => {
    const canonical = canonicalChain(5);
    const node = new FakeNode(canonical);
    const result = await processNewBlock(node, 5, settings);
    expect(result).toMatchObject({ status: 'inserted', reorg: undefined });
    expect(await dbHash(5)).toBe(canonical[5].hash);
  });
});

describe('verifyConfirmationWindow', () => {
  it('replaces a mismatching height inside the window and leaves the rest', async () => {
    const canonical = canonicalChain(20, { 17: ['0xc17'] });
    const orphan17 = block(17, 'orp', canonical[16].hash, ['0xo17']);
    await seed([...canonical.slice(0, 17), orphan17, ...canonical.slice(18)]);

    const node = new FakeNode(canonical);
    const replaced = await verifyConfirmationWindow(node, 20, 12);

    expect(replaced).toEqual([17]);
    expect(node.headerCalls).toBe(13); // head-12 .. head
    expect(await dbHash(17)).toBe(canonical[17].hash);
    expect(await Transaction.countDocuments({ hash: '0xo17' })).toBe(0);
    expect(await Transaction.countDocuments({ hash: '0xc17' })).toBe(1);
    expect(await verifyConfirmationWindow(node, 20, 12)).toEqual([]);
  });
});

describe('findCommonAncestor', () => {
  it('skips DB gaps and stops at maxDepth', async () => {
    const canonical = canonicalChain(10);
    const orp9 = block(9, 'orp', canonical[8].hash);
    const orp10 = block(10, 'orp', orp9.hash);
    await seed([...canonical.slice(0, 7), orp9, orp10]); // height 7 and 8 missing in the DB
    const node = new FakeNode(canonical);
    expect(await findCommonAncestor(node, 10, 64)).toBe(6);
    expect(await findCommonAncestor(node, 10, 2)).toBeNull();
  });
});
