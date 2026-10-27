/**
 * Index management tests (mongodb-memory-server).
 *
 * Verifies that `ensureIndexes()` creates the schema-declared indexes, is
 * idempotent, skips unique indexes when duplicate keys exist, honours
 * `SKIP_INDEX_SYNC`, and that `checkIndexes()` reports what is missing.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  Block,
  Transaction,
  ALL_MODELS,
  MODEL_COLLECTIONS,
  checkIndexes,
  ensureIndexes,
  ensureIndexesOnStartup,
  isIndexSyncSkipped,
} from '@/models/index';
import {
  countDuplicateKeys,
  indexNameFor,
  listIndexNames,
  schemaIndexSpecs,
} from '@/lib/db/indexes';

let mongod: MongoMemoryServer;

async function indexMap(model: (typeof ALL_MODELS)[number]) {
  const indexes = await model.collection.indexes();
  return new Map(indexes.map((index) => [String(index.name), index]));
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('explorerDB_test'), {
    autoIndex: false,
    autoCreate: false,
  });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(async () => {
  delete process.env.SKIP_INDEX_SYNC;
  await mongoose.connection.db?.dropDatabase();
});

describe('indexNameFor / schemaIndexSpecs', () => {
  it('derives MongoDB default index names from the key pattern', () => {
    expect(indexNameFor({ number: 1 })).toBe('number_1');
    expect(indexNameFor({ miner: 1, number: -1 })).toBe('miner_1_number_-1');
    expect(indexNameFor({ a: 1 }, { name: 'custom' })).toBe('custom');
  });

  it('lists the Block schema indexes with their collection name and unique flag', () => {
    const specs = schemaIndexSpecs(Block);
    const byName = new Map(specs.map((spec) => [spec.name, spec]));
    expect(byName.get('number_1')?.unique).toBe(true);
    expect(byName.get('hash_1')?.unique).toBe(true);
    expect(byName.get('miner_1_number_-1')?.unique).toBe(false);
    expect(specs.every((spec) => spec.collection === 'Block')).toBe(true);
    // `background` is never forwarded to the driver
    expect(specs.some((spec) => 'background' in spec.options)).toBe(false);
  });

  it('maps every model to an explicit collection name', () => {
    expect(MODEL_COLLECTIONS.Block).toBe('Block');
    expect(MODEL_COLLECTIONS.Transaction).toBe('Transaction');
    expect(Object.keys(MODEL_COLLECTIONS)).toHaveLength(ALL_MODELS.length);
  });
});

describe('isIndexSyncSkipped', () => {
  it('is true only for 1/true/yes', () => {
    expect(isIndexSyncSkipped({})).toBe(false);
    expect(isIndexSyncSkipped({ SKIP_INDEX_SYNC: '0' })).toBe(false);
    expect(isIndexSyncSkipped({ SKIP_INDEX_SYNC: '1' })).toBe(true);
    expect(isIndexSyncSkipped({ SKIP_INDEX_SYNC: 'TRUE' })).toBe(true);
    expect(isIndexSyncSkipped({ SKIP_INDEX_SYNC: 'yes' })).toBe(true);
  });
});

describe('ensureIndexes', () => {
  it('creates the unique Block.number / Block.hash and Transaction.hash indexes on an empty DB', async () => {
    expect(await listIndexNames(Block)).toEqual([]);

    const result = await ensureIndexes();
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.created).toContain('Block.number_1');
    expect(result.created).toContain('Block.hash_1');
    expect(result.created).toContain('Transaction.hash_1');

    const block = await indexMap(Block);
    expect(block.get('number_1')?.unique).toBe(true);
    expect(block.get('hash_1')?.unique).toBe(true);
    expect(block.has('miner_1_number_-1')).toBe(true);

    const tx = await indexMap(Transaction);
    expect(tx.get('hash_1')?.unique).toBe(true);

    // Every schema-declared index of every model now exists
    expect(await checkIndexes()).toEqual([]);
  });

  it('is idempotent: a second run creates nothing and reports everything as existing', async () => {
    const first = await ensureIndexes();
    const second = await ensureIndexes();
    expect(second.created).toEqual([]);
    expect(second.failed).toEqual([]);
    expect(second.existing.sort()).toEqual(first.created.sort());
  });

  it('skips only the unique index whose keys are duplicated and keeps the rest', async () => {
    const hash = '0x' + 'ab'.repeat(32);
    await Transaction.collection.insertMany([
      { hash, blockNumber: 1, transactionIndex: 0 },
      { hash, blockNumber: 2, transactionIndex: 0 },
    ]);
    expect(await countDuplicateKeys(Transaction, { hash: 1 })).toEqual({
      keys: 1,
      extraDocuments: 1,
    });

    const result = await ensureIndexes();
    expect(result.failed).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      model: 'Transaction',
      collection: 'Transaction',
      index: 'hash_1',
    });
    expect(result.skipped[0].reason).toMatch(/1 duplicate key/);

    const tx = await indexMap(Transaction);
    expect(tx.has('hash_1')).toBe(false);
    expect(tx.has('blockNumber_-1_transactionIndex_-1')).toBe(true);
    // Other collections are unaffected
    expect((await indexMap(Block)).get('number_1')?.unique).toBe(true);

    const missing = await checkIndexes();
    expect(missing.map((spec) => `${spec.collection}.${spec.name}`)).toEqual([
      'Transaction.hash_1',
    ]);
  });

  it('reports planned indexes without creating anything in dry-run mode', async () => {
    const result = await ensureIndexes({ dryRun: true });
    expect(result.planned).toContain('Block.number_1');
    expect(result.created).toEqual([]);
    expect(await listIndexNames(Block)).toEqual([]);
  });

  it('does nothing when SKIP_INDEX_SYNC=1', async () => {
    process.env.SKIP_INDEX_SYNC = '1';
    const result = await ensureIndexes();
    expect(result).toEqual({ created: [], existing: [], planned: [], skipped: [], failed: [] });
    expect(await listIndexNames(Block)).toEqual([]);
  });

  it('ensureIndexesOnStartup never throws and returns the result', async () => {
    const result = await ensureIndexesOnStartup('vitest');
    expect(result.created).toContain('Block.number_1');
  });
});

describe('countDuplicateKeys', () => {
  it('counts compound duplicates and ignores unique values', async () => {
    await Block.collection.insertMany([
      { number: 1, hash: '0x01' },
      { number: 2, hash: '0x02' },
      { number: 2, hash: '0x02' },
      { number: 2, hash: '0x02' },
    ]);
    expect(await countDuplicateKeys(Block, { number: 1 })).toEqual({ keys: 1, extraDocuments: 2 });
    expect(await countDuplicateKeys(Block, { number: 1, hash: 1 })).toEqual({
      keys: 1,
      extraDocuments: 2,
    });
    expect(await countDuplicateKeys(Block, { hash: 1 }, { sparse: true })).toEqual({
      keys: 1,
      extraDocuments: 2,
    });
  });

  it('returns zero for a collection that does not exist yet', async () => {
    expect(await countDuplicateKeys(Block, { number: 1 })).toEqual({ keys: 0, extraDocuments: 0 });
  });
});
