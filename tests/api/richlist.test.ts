/**
 * /api/richlist: accounts in numeric balance order, contracts marked from the Contract records,
 * totals counted over the accounts holding coins; the DataTables POST sorts by type as well.
 * mongodb-memory-server; the supply is stubbed (it reads the node).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Account, Contract } from '@/models/index';
import { GET, POST } from '@/app/api/richlist/route';

vi.mock('@/lib/supply', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supply')>()),
  calculateTotalSupply: async () => 100,
}));

const COIN = 10n ** 18n;
const pad = (prefix: string) => `0x${prefix.padEnd(40, '0')}`;
let mongod: MongoMemoryServer;
let ip = 0;

function request(path: string, body?: unknown): NextRequest {
  ip += 1;
  return new NextRequest(`https://explorer.example${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-client-ip': `198.51.100.${ip}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('explorerDB_richlist');
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
  await Account.collection.insertMany([
    // as strings "9..." sorts above "10...": the order must be numeric
    { address: pad('a1'), balance: (9n * COIN).toString(), blockNumber: 5, type: 0 },
    { address: pad('a2'), balance: (10n * COIN).toString(), blockNumber: 6, type: 1 },
    { address: pad('a3'), balance: (1n * COIN).toString(), blockNumber: 7, type: 0 },
    { address: pad('a4'), balance: '0', blockNumber: 8, type: 0 },
  ]);
  await Contract.collection.insertOne({ address: pad('a2') });
});

describe('GET /api/richlist', () => {
  it('lists the accounts holding coins by balance and marks contracts', async () => {
    const body = await (await GET(request('/api/richlist?limit=10'))).json();
    expect(
      body.richlist.map((row: { address: string; rank: number; type: string }) => [
        row.rank,
        row.address,
        row.type,
      ])
    ).toEqual([
      [1, pad('a2'), 'Contract'],
      [2, pad('a1'), 'Wallet'],
      [3, pad('a3'), 'Wallet'],
    ]);
    expect(body.richlist[0].percentage).toBe('10.0000');
    expect(body.pagination).toMatchObject({ total: 3, totalPages: 1, hasNext: false });
    expect(body.statistics).toEqual({
      totalSupply: 100,
      totalAccounts: 3,
      contractAccounts: 1,
      walletAccounts: 2,
    });
  });

  it('pages with the right ranks', async () => {
    const body = await (await GET(request('/api/richlist?page=2&limit=2'))).json();
    expect(body.richlist.map((row: { rank: number }) => row.rank)).toEqual([3]);
    expect(body.pagination).toMatchObject({ page: 2, total: 3, hasPrev: true, hasNext: false });
  });
});

describe('POST /api/richlist (DataTables)', () => {
  it('sorts by balance either way and by type', async () => {
    const rows = async (order: unknown) =>
      (
        await (
          await POST(request('/api/richlist', { draw: 1, start: 0, length: 10, order }))
        ).json()
      ).data.map((row: unknown[]) => row[1]);
    expect(await rows(undefined)).toEqual([pad('a2'), pad('a1'), pad('a3'), pad('a4')]);
    expect(await rows([{ column: 3, dir: 'asc' }])).toEqual([
      pad('a4'),
      pad('a3'),
      pad('a1'),
      pad('a2'),
    ]);
    // contracts first, then the largest balances
    expect(await rows([{ column: 2, dir: 'asc' }])).toEqual([
      pad('a2'),
      pad('a1'),
      pad('a3'),
      pad('a4'),
    ]);
  });
});
