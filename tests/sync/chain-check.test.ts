/**
 * checkChain / sampleAgainstNode / repairChain (lib/sync/chain-check.ts)
 * against mongodb-memory-server with a fake canonical node.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Block, ScanProgress, Transaction } from '@/models/index';
import { checkChain, repairChain, sampleAgainstNode, REPAIR_SCAN_TYPE } from '@/lib/sync';
import { parseArgs } from '../../tools/repair-chain';
import { FakeNode, block, canonicalChain, dbHash, seed, type TestBlock } from './helpers';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('explorerDB_repair'), {
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

/** Canonical 0..12 with isolated orphans stored at 3, 6 and 9 (each carrying one orphan tx). */
async function seedThreeOrphans(): Promise<TestBlock[]> {
  const canonical = canonicalChain(12, { 3: ['0xc3'], 6: ['0xc6'], 9: ['0xc9'] });
  const stored = canonical.map((b) =>
    [3, 6, 9].includes(b.number)
      ? block(b.number, 'orp', canonical[b.number - 1].hash, [`0xo${b.number}`])
      : b
  );
  await seed(stored);
  return canonical;
}

describe('checkChain', () => {
  it('counts parentHash mismatches and gaps', async () => {
    await seedThreeOrphans();
    const result = await checkChain();
    expect(result).toMatchObject({
      scanned: 13,
      first: 0,
      last: 12,
      gaps: 0,
      mismatches: 3,
      mismatchHeights: [3, 6, 9],
    });

    await Block.deleteMany({ number: { $in: [10, 11] } });
    const withGap = await checkChain();
    expect(withGap.gaps).toBe(2);
    expect(withGap.gapRanges).toEqual([[10, 11]]);
    expect(withGap.scanned).toBe(11);

    expect((await checkChain({ from: 4, to: 8 })).mismatches).toBe(1);
  });

  it('reports a clean chain as 0 mismatches', async () => {
    await seed(canonicalChain(20));
    expect(await checkChain()).toMatchObject({ scanned: 21, gaps: 0, mismatches: 0 });
  });
});

describe('sampleAgainstNode', () => {
  it('finds the orphans among sampled heights', async () => {
    const canonical = await seedThreeOrphans();
    const node = new FakeNode(canonical);
    const everything = await sampleAgainstNode(node, 13, { random: Math.random });
    expect(everything).toMatchObject({ requested: 13, checked: 13, missingInDb: 0, mismatches: 3 });
    expect(everything.examples.map((e) => e.height)).toEqual([3, 6, 9]);
    expect(await sampleAgainstNode(new FakeNode(canonical), 0)).toMatchObject({
      checked: 0,
      mismatches: 0,
    });
  });
});

describe('repairChain', () => {
  it('dry-run plans the replacements without writing', async () => {
    const canonical = await seedThreeOrphans();
    const node = new FakeNode(canonical);
    const result = await repairChain(node, { dryRun: true });
    expect(result.sites).toBe(3);
    expect(result.planned.map((p) => p.height)).toEqual([3, 6, 9]);
    expect(result.planned[0]).toEqual({
      height: 3,
      oldHash: (await dbHash(3)) ?? '',
      newHash: canonical[3].hash,
    });
    expect(result.replaced).toEqual([3, 6, 9]);
    expect(result.verification).toBeNull();
    expect((await checkChain()).mismatches).toBe(3); // nothing changed
    expect(await Transaction.countDocuments({ hash: '0xo3' })).toBe(1);
  });

  it('--fix replaces the orphans, swaps their transactions and verifies 0 mismatches', async () => {
    const canonical = await seedThreeOrphans();
    const node = new FakeNode(canonical);
    const result = await repairChain(node, {});
    expect(result.replaced).toEqual([3, 6, 9]);
    expect(result).toMatchObject({
      minReplaced: 3,
      maxReplaced: 9,
      deletedTransactions: 3,
      addedTransactions: 3,
      skippedSites: [],
      capReached: [],
    });
    expect(result.verification).toMatchObject({ mismatches: 0, gaps: 0, scanned: 13 });
    for (const h of [3, 6, 9]) expect(await dbHash(h)).toBe(canonical[h].hash);
    expect(await Transaction.countDocuments({ hash: { $in: ['0xo3', '0xo6', '0xo9'] } })).toBe(0);
    expect(await Transaction.countDocuments({ hash: { $in: ['0xc3', '0xc6', '0xc9'] } })).toBe(3);
    expect(await ScanProgress.countDocuments({ scanType: REPAIR_SCAN_TYPE })).toBe(0); // cleared after success
  });

  it('repairs a contiguous orphan branch from the common ancestor until the chain reconnects', async () => {
    const canonical = canonicalChain(12);
    const orp5 = block(5, 'orp', canonical[4].hash, ['0xo5']);
    const orp6 = block(6, 'orp', orp5.hash);
    const orp7 = block(7, 'orp', orp6.hash);
    await seed([...canonical.slice(0, 5), orp5, orp6, orp7, ...canonical.slice(8)]);
    expect((await checkChain()).mismatches).toBe(1); // only the 7→8 link is broken

    const result = await repairChain(new FakeNode(canonical), {});
    expect(result.replaced).toEqual([5, 6, 7]);
    expect(result.verification?.mismatches).toBe(0);
    expect(await Transaction.countDocuments({ hash: '0xo5' })).toBe(0);
  });

  it('respects the ancestor depth and the per-site replacement cap', async () => {
    const canonical = canonicalChain(12);
    const orphans: TestBlock[] = [];
    for (let h = 5; h <= 9; h++) {
      orphans.push(block(h, 'orp', h === 5 ? canonical[4].hash : orphans[orphans.length - 1].hash));
    }
    await seed([...canonical.slice(0, 5), ...orphans, ...canonical.slice(10)]);
    expect((await checkChain()).mismatchHeights).toEqual([9]); // only the 9→10 link is broken

    // Ancestor search limited to 1 height cannot reach height 4: the site is skipped
    const shallow = await repairChain(new FakeNode(canonical), { maxDepth: 1 });
    expect(shallow.skippedSites).toEqual([{ height: 9, reason: 'no common ancestor within 1' }]);
    expect(shallow.replaced).toEqual([]);

    // Cap of 2 replacements per site: 5 and 6 are fixed, 7..9 remain orphaned
    const capped = await repairChain(new FakeNode(canonical), { maxReplacePerSite: 2 });
    expect(capped.replaced).toEqual([5, 6]);
    expect(capped.capReached).toEqual([9]);
    expect(capped.verification?.mismatchHeights).toEqual([6, 9]); // 6→7 and 9→10 still broken

    const finished = await repairChain(new FakeNode(canonical), { from: 0 });
    expect(finished.replaced).toEqual([7, 8, 9]);
    expect(finished.verification?.mismatches).toBe(0);
  });

  it('resumes from the saved repair position', async () => {
    const canonical = await seedThreeOrphans();
    await ScanProgress.collection.insertOne({ scanType: REPAIR_SCAN_TYPE, lastScannedBlock: 6 });
    const result = await repairChain(new FakeNode(canonical), {});
    expect(result.sites).toBe(1); // only the site above 6 is considered
    expect(result.replaced).toEqual([9]);
  });
});

describe('repair-chain parseArgs', () => {
  it('maps flags to options', () => {
    expect(parseArgs(['--check'])).toMatchObject({ mode: 'check', dryRun: false });
    expect(parseArgs(['--sample', '50'])).toMatchObject({ mode: 'sample', sampleSize: 50 });
    expect(parseArgs(['--sample'])).toMatchObject({ mode: 'sample', sampleSize: 1000 });
    expect(
      parseArgs([
        '--fix',
        '--from',
        '100',
        '--to',
        '200',
        '--dry-run',
        '--max-depth',
        '8',
        '--max-replace',
        '16',
      ])
    ).toEqual({
      mode: 'fix',
      sampleSize: 1000,
      from: 100,
      to: 200,
      dryRun: true,
      maxDepth: 8,
      maxReplace: 16,
    });
    expect(parseArgs([])).toMatchObject({ mode: 'help' });
  });
});
