/**
 * Reorg handling (lib/sync/reorg.ts) against mongodb-memory-server with a
 * fake node that serves the canonical chain.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  Block,
  InternalTransaction,
  ScanProgress,
  Token,
  TokenTransfer,
  Transaction,
} from '@/models/index';
import {
  findCommonAncestor,
  normalizeBlock,
  normalizeTransaction,
  processNewBlock,
  replaceBlock,
  resolveSyncSettings,
  verifyConfirmationWindow,
  type SyncSettings,
} from '@/lib/sync';
import { FakeNode, block, canonicalChain, dbHash, hashOf, seed, tx } from './helpers';

let mongod: MongoMemoryServer;

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

  it('stores what the web3.js sync stored from what viem returns', () => {
    // block 1 of VirBiCoin: viem gives the nonce in hex, the database holds it in decimal
    const raw = {
      ...block(1, 'can', hashOf('can', 0)),
      nonce: '0x69412da3cce24933',
      size: '0x21c',
    };
    expect(normalizeBlock(raw)).toMatchObject({ nonce: '7584393429008927027', size: 540 });

    const creation = { ...tx('0xc1', raw), to: null, value: 0n, gas: 3_000_000n };
    const receipt = {
      status: 'success',
      gasUsed: 2_777_179n,
      contractAddress: '0xD26488EA362005B023BC9F55157370C63C94D0C7',
    };
    expect(normalizeTransaction(creation, receipt, raw)).toMatchObject({
      to: null,
      creates: '0xd26488ea362005b023bc9f55157370c63c94d0c7',
      status: 1,
      gasUsed: 2_777_179,
      value: '0',
      gas: 3_000_000,
    });
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
    await ScanProgress.collection.insertOne({ scanType: 'tokens', lastScannedBlock: 500 });
    // token transfer markers above the replaced height are rewound, the others kept
    await Token.collection.insertMany([
      { address: '0xt1', transfersScannedTo: 500 },
      { address: '0xt2', transfersScannedTo: 5 },
    ]);

    const node = new FakeNode(canonical);
    const result = await processNewBlock(node, 11, settings);

    expect(result.status).toBe('inserted');
    expect(result.reorg).toMatchObject({ resolved: true, ancestor: 9, replaced: [10] });
    expect(await dbHash(10)).toBe(canonical[10].hash);
    expect(await dbHash(11)).toBe(canonical[11].hash);
    expect(await Transaction.countDocuments({ hash: '0xorphantx' })).toBe(0);
    expect(await Transaction.countDocuments({ hash: '0xcan10tx' })).toBe(1);
    expect(await TokenTransfer.countDocuments({})).toBe(0);
    const markers = await Token.collection.find({}).sort({ address: 1 }).toArray();
    expect(markers.map((token) => token.transfersScannedTo)).toEqual([9, 5]);
    const scan = (await ScanProgress.findOne({ scanType: 'tokens' }).lean()) as {
      lastScannedBlock: number;
    };
    expect(scan.lastScannedBlock).toBe(9);
  });

  it('removes the internal transactions of an orphaned block and rewinds the range indexers', async () => {
    const canonical = canonicalChain(11, { 10: ['0xcan10tx'] });
    const orphan10 = block(10, 'orp', canonical[9].hash, ['0xorphantx']);
    await seed([...canonical.slice(0, 10), orphan10]);
    await InternalTransaction.collection.insertMany([
      { transactionHash: '0xorphantx', index: 1, blockNumber: 10, blockHash: orphan10.hash },
      { transactionHash: '0xolder', index: 1, blockNumber: 9, blockHash: canonical[9].hash },
    ]);
    await ScanProgress.collection.insertMany([
      { scanType: 'internal-transactions', lastScannedBlock: 500, generation: 3 },
      // still working on a range that holds height 10
      { scanType: 'erc1155', lastScannedBlock: 5, inFlightTo: 20 },
      // the live head only: nothing to rewind
      { scanType: 'tokens', lastScannedBlock: 8 },
    ]);

    await processNewBlock(new FakeNode(canonical), 11, settings);

    expect(await InternalTransaction.countDocuments({ transactionHash: '0xorphantx' })).toBe(0);
    expect(await InternalTransaction.countDocuments({ transactionHash: '0xolder' })).toBe(1);
    const markers = (await ScanProgress.find({}).lean()) as Array<{
      scanType: string;
      lastScannedBlock: number;
      generation?: number;
    }>;
    const byType = Object.fromEntries(markers.map((marker) => [marker.scanType, marker]));
    expect(byType['internal-transactions']).toMatchObject({ lastScannedBlock: 9, generation: 4 });
    // below the rewritten heights the marker stays; heights 10 (reorg) and 11 (new block) both lie
    // in the announced range, and each bump tells the indexer to redo its range
    expect(byType.erc1155).toMatchObject({ lastScannedBlock: 5, generation: 2 });
    expect(byType.tokens.lastScannedBlock).toBe(8);
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
