/**
 * Uncle issuance (lib/sync/uncle-rewards.ts): recorded by replaceBlock(),
 * cleared when a replacement has no uncles, filled by the backfill, and summed
 * by the supply calculation. mongodb-memory-server + the fake node.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Block, ScanProgress, Transaction } from '@/models/index';
import {
  UNCLE_REWARD_SCAN,
  backfillUncleRewards,
  fetchUncleReward,
  normalizeBlock,
  replaceBlock,
  upsertBlocks,
} from '@/lib/sync';
import { calculateTotalMiningRewardWei, parseRewardSchedule } from '@/lib/reward-schedule';

// The supply and uncle code read the schedule from config.json; pin one with an 8-coin reward
// that drops to 7 at block 4,200,000 so the expected amounts do not depend on the local config.
const SCHEDULE = parseRewardSchedule({ blockReward: { '0': '8', '4200000': '7' } });
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  getRewardSchedule: () => SCHEDULE,
}));
import { clearSupplyCache, computeTotalSupplyWei, getUncleIssuanceWei } from '@/lib/supply';
import { FakeNode, addUncles, block, canonicalChain, seed } from './helpers';

let mongod: MongoMemoryServer;

const COIN = 10n ** 18n;
/** `whole` coins plus `quarters` × 0.25 coins, in wei */
const coins = (whole: number, quarters = 0) =>
  BigInt(whole) * COIN + (BigInt(quarters) * COIN) / 4n;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('explorerDB_uncles'), {
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
  clearSupplyCache();
});

const storedReward = async (height: number) =>
  ((await Block.findOne({ number: height }).lean()) as { uncleReward?: string } | null)
    ?.uncleReward;

describe('fetchUncleReward', () => {
  it('sums uncle and nephew rewards from the uncle heights on the node', async () => {
    const chain = canonicalChain(12);
    const node = new FakeNode(chain);
    addUncles(node, chain[12], [11, 10]);
    // 7 + 6 to the uncle miners, 2 × 0.25 to the block miner
    expect(await fetchUncleReward(node, chain[12])).toBe(coins(13, 2).toString());
    expect(await fetchUncleReward(node, chain[11])).toBeUndefined();
  });

  it('refuses a node answer that does not match the uncle listed in the block', async () => {
    const chain = canonicalChain(12);
    const node = new FakeNode(chain);
    addUncles(node, chain[12], [11]);
    chain[12].uncles = ['0xffff'];
    await expect(fetchUncleReward(node, chain[12])).rejects.toThrow(/uncle 0 of block 12/);
  });
});

describe('replaceBlock', () => {
  it('records the uncle issuance of a new height', async () => {
    const chain = canonicalChain(12);
    const node = new FakeNode(chain);
    addUncles(node, chain[12], [11]);
    await seed(chain.slice(0, 12));

    await replaceBlock(node, 12, chain[12]);
    expect(await storedReward(12)).toBe(coins(7, 1).toString());
  });

  it('drops the uncle issuance of an orphan replaced by a block without uncles', async () => {
    const chain = canonicalChain(12);
    const orphan = block(12, 'orp', chain[11].hash);
    const node = new FakeNode([...chain.slice(0, 12), orphan]);
    addUncles(node, orphan, [11]);
    await seed(chain.slice(0, 12));
    await replaceBlock(node, 12, orphan);
    expect(await storedReward(12)).toBe(coins(7, 1).toString());

    await replaceBlock(node, 12, chain[12]);
    expect(await storedReward(12)).toBeUndefined();
  });

  it('leaves the orphan untouched when an uncle lookup fails', async () => {
    const chain = canonicalChain(12, { 12: ['0x' + 'aa'.repeat(32)] });
    const replacement = block(12, 'new', chain[11].hash);
    const node = new FakeNode([...chain.slice(0, 12), replacement]);
    addUncles(node, replacement, [11]);
    await seed(chain);
    node.failUncleLookups = true;

    await expect(replaceBlock(node, 12, replacement)).rejects.toThrow('node unavailable');
    expect(await Block.findOne({ number: 12 }).lean()).toMatchObject({ hash: chain[12].hash });
    expect(await Transaction.countDocuments({ blockHash: chain[12].hash })).toBe(1);
  });
});

describe('upsertBlocks', () => {
  it('keeps a recorded amount when a block with uncles is written without one', async () => {
    const chain = canonicalChain(12);
    chain[12].uncles = ['0x' + 'bb'.repeat(32)];
    await Block.create({ ...normalizeBlock(chain[12]), uncleReward: '123' });

    await upsertBlocks([normalizeBlock(chain[12])]);
    expect(await storedReward(12)).toBe('123');
  });
});

describe('backfillUncleRewards', () => {
  it('fills missing amounts, skips filled blocks and saves its position', async () => {
    const chain = canonicalChain(20);
    const node = new FakeNode(chain);
    addUncles(node, chain[5], [4]);
    addUncles(node, chain[9], [7, 8]);
    addUncles(node, chain[15], [14]);
    await seed(chain);
    await Block.updateOne({ number: 15 }, { $set: { uncleReward: coins(7, 1).toString() } });

    const dry = await backfillUncleRewards({ node, dryRun: true, batchSize: 4 });
    expect(dry).toMatchObject({ withUncles: 3, alreadySet: 1, filled: 2, failedCount: 0 });
    expect(await storedReward(5)).toBeUndefined();
    expect(await ScanProgress.findOne({ scanType: UNCLE_REWARD_SCAN }).lean()).toBeNull();

    const run = await backfillUncleRewards({ node, batchSize: 4 });
    expect(run).toMatchObject({ scanned: 21, withUncles: 3, alreadySet: 1, filled: 2 });
    // 7.25 for block 5; 6 + 7 + 0.5 for block 9
    expect(run.filledWei).toBe((coins(7, 1) + coins(13, 2)).toString());
    expect(await storedReward(5)).toBe(coins(7, 1).toString());
    expect(await storedReward(9)).toBe(coins(13, 2).toString());
    expect(await ScanProgress.findOne({ scanType: UNCLE_REWARD_SCAN }).lean()).toMatchObject({
      lastScannedBlock: 20,
    });

    // A plain re-run resumes after the saved position; --from 0 rescans and fills nothing new
    expect(await backfillUncleRewards({ node })).toMatchObject({ scanned: 0, filled: 0 });
    expect(await backfillUncleRewards({ node, from: 0 })).toMatchObject({
      withUncles: 3,
      alreadySet: 3,
      filled: 0,
    });
  });

  it('reports stored blocks that are not canonical instead of filling them', async () => {
    const chain = canonicalChain(10);
    const orphan = block(8, 'orp', chain[7].hash);
    const node = new FakeNode(chain);
    addUncles(node, orphan, [7]);
    await seed([...chain.slice(0, 8), orphan, ...chain.slice(9)]);

    const summary = await backfillUncleRewards({ node });
    expect(summary).toMatchObject({ withUncles: 1, filled: 0, failedCount: 1 });
    expect(summary.failed[0]).toMatchObject({ number: 8 });
    expect(summary.failed[0].error).toMatch(/not the canonical block/);
    expect(await storedReward(8)).toBeUndefined();
  });

  it('uses the node block when only sha3Uncles shows that uncles exist', async () => {
    const chain = canonicalChain(10);
    const node = new FakeNode(chain);
    addUncles(node, chain[6], [5]);
    await seed(chain);
    await Block.updateOne({ number: 6 }, { $set: { uncles: [], sha3Uncles: '0x1234' } });

    expect(await backfillUncleRewards({ node })).toMatchObject({ withUncles: 1, filled: 1 });
    expect(await storedReward(6)).toBe(coins(7, 1).toString());
  });
});

describe('supply', () => {
  it('adds the recorded uncle issuance to the scheduled block rewards', async () => {
    const chain = canonicalChain(12);
    await seed(chain);
    await Block.updateOne({ number: 5 }, { $set: { uncleReward: coins(7, 1).toString() } });
    await Block.updateOne({ number: 9 }, { $set: { uncleReward: coins(13, 2).toString() } });

    expect(await getUncleIssuanceWei()).toBe(coins(20, 3));
  });

  it('adds pre-mine, the reward schedule and uncle issuance in wei', () => {
    // 1 coin pre-mine + 8 coins × 100 blocks + 7.25 coins of uncle issuance
    expect(computeTotalSupplyWei(100, 1, coins(7, 1))).toBe(coins(808, 1));
    // blocks 1..4,200,000: 8 coins each except the block where the reward drops (7 coins)
    expect(computeTotalSupplyWei(4_200_000, 0, 0n)).toBe(
      calculateTotalMiningRewardWei(SCHEDULE, 4_200_000)
    );
    expect(calculateTotalMiningRewardWei(SCHEDULE, 4_200_000)).toBe(coins(4_199_999 * 8 + 7));
  });
});
