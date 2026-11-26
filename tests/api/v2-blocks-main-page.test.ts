/**
 * Blockscout v2 block objects (fees, rewards, gas percentages, nonce, miner) and the
 * routes added for Blockscout clients: main-page blocks / transactions / indexing-status,
 * addresses/{hash}/blocks-validated and tabs-counters, smart-contracts/counters and the
 * transactions / market charts. mongodb-memory-server; the node is a closed port.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  Block,
  Contract,
  InternalTransaction,
  Market,
  ScanProgress,
  TokenTransfer,
  Transaction,
} from '@/models/index';
import { apiCache } from '@/lib/cache';
import { parseRewardSchedule } from '@/lib/reward-schedule';
import { GET as blocksGet } from '@/app/api/v2/blocks/route';
import { GET as blockGet } from '@/app/api/v2/blocks/[numberOrHash]/route';
import { GET as mainBlocksGet } from '@/app/api/v2/main-page/blocks/route';
import { GET as mainTransactionsGet } from '@/app/api/v2/main-page/transactions/route';
import { GET as indexingStatusGet } from '@/app/api/v2/main-page/indexing-status/route';
import { GET as blocksValidatedGet } from '@/app/api/v2/addresses/[address]/blocks-validated/route';
import { GET as tabsCountersGet } from '@/app/api/v2/addresses/[address]/tabs-counters/route';
import { GET as contractCountersGet } from '@/app/api/v2/smart-contracts/counters/route';
import { GET as transactionsChartGet } from '@/app/api/v2/stats/charts/transactions/route';
import { GET as marketChartGet } from '@/app/api/v2/stats/charts/market/route';

vi.hoisted(() => {
  // nothing listens here: node calls fail at once
  process.env.WEB3_PROVIDER_URL = 'http://127.0.0.1:1';
});

// A flat 2-coin reward, and a trace source the tests switch on and off
const REWARDS = parseRewardSchedule({ blockReward: { '0': '2' } });
const traces = vi.hoisted(() => ({ url: null as string | null }));
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  getRewardSchedule: () => REWARDS,
  getTraceSourceUrl: () => traces.url,
}));

const COIN = 10n ** 18n;
const pad = (prefix: string, length: number) => `0x${prefix.padEnd(length, '0')}`;
const MINER = pad('a1', 40);
const POOL = pad('b2', 40);
const ALICE = pad('a11ce', 40);
const BOB = pad('b0b', 40);
const GWEI = '1000000000';

let mongod: MongoMemoryServer;
let ipCounter = 0;

function request(path: string): NextRequest {
  ipCounter += 1;
  return new NextRequest(`https://explorer.example${path}`, {
    headers: { 'x-client-ip': `198.51.100.${ipCounter % 250}` },
  });
}

const params = <T>(value: T) => ({ params: Promise.resolve(value) });

function block(number: number, extra: Record<string, unknown> = {}) {
  return {
    number,
    hash: `0x${number.toString(16).padStart(64, '0')}`,
    parentHash: `0x${Math.max(0, number - 1)
      .toString(16)
      .padStart(64, '0')}`,
    miner: MINER,
    timestamp: 1_760_000_000 + number * 10,
    gasUsed: 21_000,
    gasLimit: 8_000_000,
    difficulty: '1000',
    totalDifficulty: '5000',
    size: 600,
    nonce: '1',
    extraData: '0x',
    transactions: [],
    uncles: [],
    ...extra,
  };
}

function tx(hash: string, blockNumber: number, index: number, extra: Record<string, unknown> = {}) {
  return {
    hash: pad(hash, 64),
    blockNumber,
    transactionIndex: index,
    from: ALICE,
    to: BOB,
    value: '1',
    gas: 21_000,
    gasUsed: 21_000,
    gasPrice: GWEI,
    input: '0x',
    status: 1,
    timestamp: 1_760_000_000 + blockNumber * 10,
    ...extra,
  };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('explorerDB_v2_blocks');
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
  apiCache.clear();
  traces.url = null;
});

describe('Blockscout block objects', () => {
  beforeEach(async () => {
    await Block.collection.insertMany([
      block(5, { miner: POOL, baseFeePerGas: GWEI }),
      // one uncle one block deep: 7/8 of the reward to its miner, 1/32 to the nephew's miner
      block(6, {
        uncles: [pad('dead', 64)],
        uncleReward: ((COIN * 2n * 7n) / 8n + (COIN * 2n) / 32n).toString(),
      }),
      block(7, { nonce: '2522163062311702768' }),
    ]);
    await Transaction.collection.insertMany([
      tx('71', 7, 0),
      tx('72', 7, 1),
      tx('51', 5, 0, { gasPrice: '3000000000' }),
    ]);
    await Contract.collection.insertOne({ address: POOL, verified: true, contractName: 'Pool' });
  });

  it('carries the fees, the miner reward and the gas percentages on the block page', async () => {
    const res = await blockGet(request('/api/v2/blocks/7'), params({ numberOrHash: '7' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const fees = 2n * 21_000n * BigInt(GWEI);
    expect(body).toMatchObject({
      height: 7,
      transactions_count: 2,
      transaction_fees: fees.toString(),
      burnt_fees: '0',
      burnt_fees_percentage: 0,
      priority_fee: '0',
      base_fee_per_gas: null,
      gas_used: '21000',
      gas_limit: '8000000',
      gas_used_percentage: 0.2625,
      gas_target_percentage: -99.475,
      nonce: '0x230085f132b350f0',
      rewards: [{ reward: (2n * COIN + fees).toString(), type: 'Miner Reward' }],
      type: 'block',
      withdrawals_count: null,
      is_pending_update: false,
      tx_fees: fees.toString(),
    });
    expect(body.miner).toMatchObject({ hash: MINER, is_contract: false });
    // the indexer has not reached the block
    expect(body.internal_transactions_count).toBeNull();
  });

  it('reports the uncle reward without the nephew part, which is the miner’s', async () => {
    const body = await (
      await blockGet(request('/api/v2/blocks/6'), params({ numberOrHash: '6' }))
    ).json();
    expect(body.rewards).toEqual([
      { reward: (2n * COIN + (2n * COIN) / 32n).toString(), type: 'Miner Reward' },
      { reward: ((2n * COIN * 7n) / 8n).toString(), type: 'Uncle Reward' },
    ]);
    expect(body.uncles_hashes).toEqual([pad('dead', 64)]);
  });

  it('subtracts burnt fees with a base fee and describes a contract miner', async () => {
    const body = await (
      await blockGet(request('/api/v2/blocks/5'), params({ numberOrHash: '5' }))
    ).json();
    const fees = 21_000n * 3_000_000_000n;
    const burnt = 21_000n * BigInt(GWEI);
    expect(body).toMatchObject({
      base_fee_per_gas: GWEI,
      transaction_fees: fees.toString(),
      burnt_fees: burnt.toString(),
      priority_fee: (fees - burnt).toString(),
      rewards: [{ reward: (2n * COIN + fees - burnt).toString(), type: 'Miner Reward' }],
    });
    expect(body.burnt_fees_percentage).toBeCloseTo(33.3333333333, 8);
    expect(body.miner).toMatchObject({ hash: POOL, is_contract: true, is_verified: true });
  });

  it('counts internal transactions once the indexer covered the block', async () => {
    await ScanProgress.collection.insertOne({
      scanType: 'internal-transactions',
      lastScannedBlock: 7,
    });
    await InternalTransaction.collection.insertMany([
      { transactionHash: pad('71', 64), index: 1, blockNumber: 7, transactionIndex: 0 },
      { transactionHash: pad('71', 64), index: 2, blockNumber: 7, transactionIndex: 0 },
    ]);
    const body = await (
      await blockGet(request('/api/v2/blocks/7'), params({ numberOrHash: '7' }))
    ).json();
    expect(body.internal_transactions_count).toBe(2);
  });

  it('finds a block by hash and answers 404 and 400 like the other routes', async () => {
    const hash = block(6).hash;
    const found = await blockGet(request(`/api/v2/blocks/${hash}`), params({ numberOrHash: hash }));
    expect((await found.json()).height).toBe(6);
    const missing = await blockGet(request('/api/v2/blocks/99'), params({ numberOrHash: '99' }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ message: 'Not found' });
    const bad = await blockGet(request('/api/v2/blocks/abc'), params({ numberOrHash: 'abc' }));
    expect(bad.status).toBe(400);
  });

  it('uses the raw reward types in lists and leaves the page-only fields null', async () => {
    const body = await (await blocksGet(request('/api/v2/blocks'))).json();
    expect(body.items.map((item: { height: number }) => item.height)).toEqual([7, 6, 5]);
    const six = body.items[1];
    expect(six.rewards.map((reward: { type: string }) => reward.type)).toEqual([
      'validator',
      'uncle',
    ]);
    expect(six.burnt_fees_percentage).toBeNull();
    expect(six.internal_transactions_count).toBeNull();
    expect(body.items[2].miner.is_contract).toBe(true);
  });

  it('has no uncle or reorg blocks to list', async () => {
    for (const type of ['uncle', 'reorg']) {
      const body = await (await blocksGet(request(`/api/v2/blocks?type=${type}`))).json();
      expect(body).toEqual({ items: [], next_page_params: null });
    }
  });

  it('gives the genesis block no reward', async () => {
    await Block.collection.insertOne(block(0));
    const body = await (
      await blockGet(request('/api/v2/blocks/0'), params({ numberOrHash: '0' }))
    ).json();
    expect(body.rewards).toEqual([]);
  });
});

describe('main page', () => {
  it('lists the 4 newest blocks and the 6 newest transactions as arrays', async () => {
    await Block.collection.insertMany([1, 2, 3, 4, 5, 6].map((n) => block(n)));
    await Transaction.collection.insertMany(
      [1, 2, 3, 4, 5, 6].flatMap((n) => [tx(`${n}a`, n, 0), tx(`${n}b`, n, 1)])
    );
    const blocks = await (await mainBlocksGet(request('/api/v2/main-page/blocks'))).json();
    expect(blocks.map((item: { height: number }) => item.height)).toEqual([6, 5, 4, 3]);
    expect(blocks[0].transactions_count).toBe(2);

    const txs = await (await mainTransactionsGet(request('/api/v2/main-page/transactions'))).json();
    expect(txs.map((item: { hash: string }) => item.hash)).toEqual(
      ['6b', '6a', '5b', '5a', '4b', '4a'].map((hash) => pad(hash, 64))
    );
    expect(txs[0]).toMatchObject({ block_number: 6, confirmations: 1, result: 'success' });
  });

  it('reports the share of stored blocks and of traced blocks', async () => {
    await Block.collection.insertMany(Array.from({ length: 50 }, (_, i) => block(50 + i)));
    let body = await (await indexingStatusGet(request('/api/v2/main-page/indexing-status'))).json();
    // blocks 50..99 of 0..99; no trace source counts as done
    expect(body).toEqual({
      finished_indexing: false,
      finished_indexing_blocks: false,
      indexed_blocks_ratio: '0.50',
      indexed_internal_transactions_ratio: '1.00',
    });

    await Block.collection.insertMany(Array.from({ length: 50 }, (_, i) => block(i)));
    traces.url = '/tmp/node.ipc';
    await ScanProgress.collection.insertOne({
      scanType: 'internal-transactions',
      lastScannedBlock: 42,
    });
    body = await (await indexingStatusGet(request('/api/v2/main-page/indexing-status'))).json();
    // the indexer stops 12 + 1 blocks below the head (86): 43 of 87
    expect(body).toMatchObject({
      finished_indexing: false,
      finished_indexing_blocks: true,
      indexed_blocks_ratio: '1.00',
      indexed_internal_transactions_ratio: '0.49',
    });

    await ScanProgress.collection.updateOne(
      { scanType: 'internal-transactions' },
      { $set: { lastScannedBlock: 86 } }
    );
    body = await (await indexingStatusGet(request('/api/v2/main-page/indexing-status'))).json();
    expect(body.finished_indexing).toBe(true);
  });
});

describe('address routes', () => {
  it('lists the blocks an address mined, with pages', async () => {
    await Block.collection.insertMany([
      ...[1, 2, 3].map((n) => block(n)),
      ...[4, 5].map((n) => block(n, { miner: POOL })),
    ]);
    const first = await (
      await blocksValidatedGet(
        request(`/api/v2/addresses/${MINER}/blocks-validated?limit=2`),
        params({ address: MINER })
      )
    ).json();
    expect(first.items.map((item: { height: number }) => item.height)).toEqual([3, 2]);
    expect(first.next_page_params).toMatchObject({ block_number: 2, page: 2, limit: 2 });
    const second = await (
      await blocksValidatedGet(
        request(`/api/v2/addresses/${MINER}/blocks-validated?page=2&limit=2`),
        params({ address: MINER })
      )
    ).json();
    expect(second.items.map((item: { height: number }) => item.height)).toEqual([1]);
    expect(second.next_page_params).toBeNull();
  });

  it('caps the tab counters at 51 and leaves unindexed ones null', async () => {
    await Transaction.collection.insertMany(
      Array.from({ length: 60 }, (_, i) => tx(`c${i.toString(16)}`, 1, i))
    );
    await TokenTransfer.collection.insertMany([
      { tokenAddress: POOL, transactionHash: pad('c0', 64), from: BOB, to: ALICE, value: '1' },
    ]);
    await Block.collection.insertMany([1, 2].map((n) => block(n, { miner: ALICE })));
    const read = async () =>
      (
        await tabsCountersGet(
          request(`/api/v2/addresses/${ALICE}/tabs-counters`),
          params({ address: ALICE })
        )
      ).json();
    expect(await read()).toEqual({
      transactions_count: 51,
      token_transfers_count: 1,
      internal_transactions_count: null,
      token_balances_count: 0,
      validations_count: 2,
      logs_count: null,
      withdrawals_count: null,
    });

    traces.url = '/tmp/node.ipc';
    await InternalTransaction.collection.insertOne({
      transactionHash: pad('c1', 64),
      index: 1,
      from: BOB,
      to: ALICE,
      blockNumber: 1,
      transactionIndex: 1,
    });
    expect((await read()).internal_transactions_count).toBe(1);
  });
});

describe('counters and charts', () => {
  it('counts contracts with code, new ones by creation block and new verifications', async () => {
    const now = Math.floor(Date.now() / 1000);
    await Block.collection.insertMany([
      block(10, { timestamp: now - 3 * 86_400 }),
      block(11, { timestamp: now - 3_600 }),
    ]);
    await Contract.collection.insertMany([
      { address: pad('c1', 40), blockNumber: 10, verified: true, verifiedAt: new Date() },
      { address: pad('c2', 40), blockNumber: 11 },
      {
        address: pad('c3', 40),
        blockNumber: 10,
        verified: true,
        verifiedAt: new Date(Date.now() - 5 * 86_400_000),
      },
      { address: pad('c4', 40), blockNumber: 11, hidden: true, hiddenReason: 'no-code' },
    ]);
    const body = await (
      await contractCountersGet(request('/api/v2/smart-contracts/counters'))
    ).json();
    expect(body).toEqual({
      smart_contracts: '3',
      new_smart_contracts_24h: '1',
      verified_smart_contracts: '2',
      new_verified_smart_contracts_24h: '1',
    });
  });

  it('counts transactions per day for the 31 days before today', async () => {
    const day = 86_400;
    const today = Math.floor(Date.now() / 1000 / day) * day;
    await Block.collection.insertMany([
      block(1, { timestamp: today - 3 * day + 100, transactions: [pad('1', 64)] }),
      block(2, { timestamp: today - day + 100, transactions: [pad('2', 64), pad('3', 64)] }),
      block(3, { timestamp: today - day + 200, transactions: [pad('4', 64)] }),
      // today is not complete and is left out
      block(4, { timestamp: today + 10, transactions: [pad('5', 64)] }),
    ]);
    const { chart_data } = await (
      await transactionsChartGet(request('/api/v2/stats/charts/transactions'))
    ).json();
    const date = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);
    expect(chart_data).toHaveLength(31);
    expect(chart_data[0]).toEqual({ date: date(today - day), transactions_count: 3 });
    expect(chart_data[1]).toEqual({ date: date(today - 2 * day), transactions_count: 0 });
    expect(chart_data[2]).toEqual({ date: date(today - 3 * day), transactions_count: 1 });
    expect(chart_data[30].date).toBe(date(today - 31 * day));
  });

  it('charts the last quote of each day as a plain decimal', async () => {
    const dayMs = 86_400_000;
    const today = Math.floor(Date.now() / dayMs) * dayMs;
    await Market.collection.insertMany([
      { symbol: 'VBC', timestamp: today - dayMs + 1_000, quoteUSD: 0.0005 },
      { symbol: 'VBC', timestamp: today - dayMs + 9_000, quoteUSD: 0.000809 },
      { symbol: 'VBC', timestamp: today - 2 * dayMs + 1_000, quoteUSD: 8.09e-7 },
      // no price and a quote older than the chart are left out
      { symbol: 'VBC', timestamp: today - 3 * dayMs + 1_000, quoteUSD: 0 },
      { symbol: 'VBC', timestamp: today - 40 * dayMs, quoteUSD: 1 },
    ]);
    const body = await (await marketChartGet(request('/api/v2/stats/charts/market'))).json();
    const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    expect(body.chart_data).toEqual([
      { date: date(today - dayMs), closing_price: '0.000809', market_cap: null, tvl: null },
      { date: date(today - 2 * dayMs), closing_price: '0.000000809', market_cap: null, tvl: null },
    ]);
    expect(body.available_supply === null || typeof body.available_supply === 'string').toBe(true);
  });
});
