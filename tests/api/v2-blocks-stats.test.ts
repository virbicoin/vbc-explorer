/**
 * /api/v2/blocks and /api/v2/stats after the removal of unfiltered
 * countDocuments({}) calls: the response shapes are unchanged, the block list
 * decides `next_page_params` from one extra row, and totals come from
 * countAll() (estimatedDocumentCount). mongodb-memory-server; no node.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Account, Block, Contract, Market, Transaction } from '@/models/index';
import { countAll } from '@/lib/db/count';
import { GET as blocksGet } from '@/app/api/v2/blocks/route';

let statsGet: (request: NextRequest) => Promise<Response>;
let mongod: MongoMemoryServer;
let ipCounter = 10;

function request(path: string): NextRequest {
  ipCounter += 1;
  return new NextRequest(`https://explorer.example${path}`, {
    headers: { 'x-client-ip': `198.51.100.${ipCounter % 250}` },
  });
}

function block(number: number) {
  return {
    number,
    hash: `0x${number.toString(16).padStart(64, '0')}`,
    parentHash: `0x${(number - 1).toString(16).padStart(64, '0')}`,
    miner: '0x1111111111111111111111111111111111111111',
    timestamp: 1_760_000_000 + number * 10,
    gasUsed: 21_000,
    gasLimit: 8_000_000,
    difficulty: '1000',
    totalDifficulty: '1000',
    size: 600,
    nonce: '0x1',
    extraData: '0x',
  };
}

beforeAll(async () => {
  // The stats route creates a Web3 instance on import: point it at a closed port
  process.env.WEB3_PROVIDER_URL = 'http://127.0.0.1:1';
  statsGet = (await import('@/app/api/v2/stats/route')).GET;
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('explorerDB_v2');
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
});

describe('GET /api/v2/blocks', () => {
  beforeEach(async () => {
    await Block.collection.insertMany([1, 2, 3, 4, 5, 6, 7].map(block));
    await Transaction.collection.insertMany([
      { hash: '0xt1', blockNumber: 7, transactionIndex: 0, from: '0xa', to: '0xb', value: '1' },
      { hash: '0xt2', blockNumber: 7, transactionIndex: 1, from: '0xa', to: '0xb', value: '1' },
    ]);
  });

  it('keeps the Blockscout shape and reports a next page from one extra row', async () => {
    const res = await blocksGet(request('/api/v2/blocks?limit=5'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(5);
    expect(body.items.map((b: { height: number }) => b.height)).toEqual([7, 6, 5, 4, 3]);
    expect(body.items[0]).toMatchObject({
      height: 7,
      hash: block(7).hash,
      transactions_count: 2,
      tx_count: 2,
      type: 'block',
      miner: { hash: '0x1111111111111111111111111111111111111111' },
    });
    expect(body.items[1].tx_count).toBe(0);
    expect(body.next_page_params).toEqual({ block_number: 3, page: 2, limit: 5, items_count: 5 });

    // sent back as the query, the way a Blockscout client pages, they yield the next page
    const query = new URLSearchParams(
      Object.entries(body.next_page_params).map(([key, value]) => [key, String(value)])
    );
    const next = await (await blocksGet(request(`/api/v2/blocks?${query}`))).json();
    expect(next.items.map((b: { height: number }) => b.height)).toEqual([2, 1]);
    expect(next.next_page_params).toBeNull();
  });

  it('returns next_page_params null on the last page and an empty page after it', async () => {
    const last = await (await blocksGet(request('/api/v2/blocks?page=2&limit=5'))).json();
    expect(last.items.map((b: { height: number }) => b.height)).toEqual([2, 1]);
    expect(last.next_page_params).toBeNull();

    const exact = await (await blocksGet(request('/api/v2/blocks?page=1&limit=7'))).json();
    expect(exact.items).toHaveLength(7);
    expect(exact.next_page_params).toBeNull();

    const beyond = await (await blocksGet(request('/api/v2/blocks?page=3&limit=5'))).json();
    expect(beyond.items).toEqual([]);
    expect(beyond.next_page_params).toBeNull();
  });
});

describe('GET /api/v2/stats', () => {
  it('reports totals from collection metadata and keeps filtered counts exact', async () => {
    const now = Math.floor(Date.now() / 1000);
    await Block.collection.insertMany([1, 2, 3].map(block));
    await Transaction.collection.insertMany(
      ['0xt1', '0xt2', '0xt3'].map((hash, i) => ({
        hash,
        blockNumber: 3,
        transactionIndex: i,
        from: '0xa',
        to: '0xb',
        value: '1',
        timestamp: now - 60,
      }))
    );
    await Account.collection.insertMany(
      ['0xa', '0xb', '0xc', '0xd'].map((address) => ({ address, balance: '1', type: 0 }))
    );
    await Contract.collection.insertMany([
      { address: '0xc1', verified: true, hidden: false },
      { address: '0xc2', verified: true, hidden: true },
      { address: '0xc3', verified: false, hidden: false },
    ]);

    const res = await statsGet(request('/api/v2/stats'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      total_blocks: '3',
      total_transactions: '3',
      transactions_today: '3',
      total_addresses: '4',
      total_verified_contracts: '1',
    });
    expect(typeof body.gas_prices).toBe('object');
  });
});

describe('GET /api/v2/stats price fields', () => {
  it('reports the stored price, its 24h change and the market cap', async () => {
    await Block.collection.insertMany([1, 2, 3].map(block));
    const now = Date.now();
    await Market.collection.insertMany([
      {
        symbol: 'VBC',
        timestamp: now - 24 * 60 * 60 * 1000,
        quoteUSD: 0.001,
        quoteBTC: 0,
        source: 'dex',
      },
      { symbol: 'VBC', timestamp: now - 60_000, quoteUSD: 0.0008, quoteBTC: 0, source: 'dex' },
    ]);
    const body = await (await statsGet(request('/api/v2/stats'))).json();
    expect(body.coin_price).toBe('0.0008');
    expect(body.coin_price_change_percentage).toBe(-20);
    expect(Number(body.market_cap)).toBeGreaterThan(0);
    expect(Number(body.market_cap)).toBeCloseTo(
      (Number(body.circulating_supply) / 1e18) * 0.0008,
      1
    );
  });

  it('reports no price without a fresh one', async () => {
    await Block.collection.insertMany([1, 2, 3].map(block));
    await Market.collection.insertOne({
      symbol: 'VBC',
      timestamp: Date.now() - 60 * 60 * 1000,
      quoteUSD: 0.0008,
      quoteBTC: 0,
    });
    const body = await (await statsGet(request('/api/v2/stats'))).json();
    expect(body).toMatchObject({
      coin_price: null,
      coin_price_change_percentage: null,
      market_cap: null,
    });
  });
});

describe('countAll', () => {
  it('works for Mongoose models and native collections, and is 0 for an empty collection', async () => {
    expect(await countAll(Block)).toBe(0);
    await Block.collection.insertMany([1, 2, 3, 4].map(block));
    expect(await countAll(Block)).toBe(4);
    const native = mongoose.connection.db!.collection('Block');
    expect(await countAll(native)).toBe(4);
    expect(await countAll(mongoose.connection.db!.collection('does_not_exist'))).toBe(0);
  });
});
