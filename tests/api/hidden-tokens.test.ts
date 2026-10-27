/**
 * Hidden (spam-name) tokens and contracts: list APIs exclude them, detail APIs
 * carry the flag, and the backfill tool classifies existing documents
 * (mongodb-memory-server).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Contract, Token } from '@/models/index';
import { classifyCollection } from '../../tools/flag-spam-tokens';

let mongod: MongoMemoryServer;

const SPAM = '0x45eb8e4810c84477371814d838b35681c5208789';
const GOOD = '0x1111111111111111111111111111111111111111';

function request(path: string, ip = '203.0.113.77'): NextRequest {
  return new NextRequest(`https://explorer.example${path}`, { headers: { 'x-client-ip': ip } });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('explorerDB_hidden');
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
  await Contract.collection.insertMany([
    {
      address: SPAM,
      contractName: 'http://127.0.0.1:2375/version',
      tokenName: 'http://127.0.0.1:2375/version',
      symbol: 'http://127.0.0.1:2375/version',
      ERC: 2,
      verified: false,
      sourceCode: '',
      hidden: true,
      hiddenReason: 'url-name',
      blockNumber: 3225544,
    },
    {
      address: GOOD,
      contractName: 'Wrapped VBC',
      tokenName: 'Wrapped VBC',
      symbol: 'WVBC',
      ERC: 2,
      verified: true,
      sourceCode: 'contract WVBC {}',
      hidden: false,
      blockNumber: 100,
    },
  ]);
  await Token.collection.insertMany([
    {
      address: SPAM,
      name: 'http://127.0.0.1:2375/version',
      symbol: 'X',
      type: 'VRC-20',
      holders: 5,
      supply: '10',
      hidden: true,
      hiddenReason: 'url-name',
    },
    {
      address: GOOD,
      name: 'Wrapped VBC',
      symbol: 'WVBC',
      type: 'VRC-20',
      holders: 5,
      supply: '10',
      hidden: false,
    },
  ]);
});

describe('GET /api/contracts', () => {
  it('never returns contracts flagged hidden', async () => {
    const { GET } = await import('../../app/api/contracts/route');
    const response = await GET(request('/api/contracts?limit=50') as never);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ address: string }>;
      meta: { pagination: { total: number } };
    };
    const addresses = body.data.map((c) => c.address.toLowerCase());
    expect(addresses).toContain(GOOD);
    expect(addresses).not.toContain(SPAM);
    expect(body.meta.pagination.total).toBe(1);
  });
});

describe('GET /api/contract/[address]', () => {
  it('still serves a hidden contract by address, with the flag', async () => {
    const { GET } = await import('../../app/api/contract/[address]/route');
    const response = await GET(request(`/api/contract/${SPAM}`) as never, {
      params: Promise.resolve({ address: SPAM }),
    });
    const body = (await response.json()) as {
      valid: boolean;
      hidden?: boolean;
      hiddenReason?: string;
    };
    expect(body.valid).toBe(true);
    expect(body.hidden).toBe(true);
    expect(body.hiddenReason).toBe('url-name');
  });
});

describe('flag-spam-tokens classifyCollection', () => {
  it('flags URL-like names, keeps normal names visible and respects manual flags', async () => {
    await Contract.collection.updateMany({}, { $set: { hidden: false, hiddenReason: null } });
    await Contract.collection.insertOne({
      address: '0x2222222222222222222222222222222222222222',
      contractName: 'Looks fine',
      symbol: 'FINE',
      hidden: true,
      hiddenReason: 'manual',
    });

    const dry = await classifyCollection(Contract, true);
    expect(dry.scanned).toBe(3);
    expect(dry.changes.map((c) => [c.address, c.to])).toEqual([[SPAM, 'hidden (url-name)']]);
    // dry run wrote nothing
    expect((await Contract.findOne({ address: SPAM }).lean())?.hidden).toBe(false);

    const applied = await classifyCollection(Contract, false);
    expect(applied.changes).toHaveLength(1);
    expect(applied.hidden).toBe(2); // the spam one + the manual one
    const spam = await Contract.findOne({ address: SPAM }).lean();
    expect(spam).toMatchObject({ hidden: true, hiddenReason: 'url-name' });
    const manual = await Contract.findOne({
      address: '0x2222222222222222222222222222222222222222',
    }).lean();
    expect(manual).toMatchObject({ hidden: true, hiddenReason: 'manual' });
    expect((await Contract.findOne({ address: GOOD }).lean())?.hidden).toBe(false);

    // a second run is a no-op
    expect((await classifyCollection(Contract, false)).changes).toEqual([]);
  });

  it('un-hides a token whose auto flag no longer applies', async () => {
    await Token.collection.updateOne(
      { address: GOOD },
      { $set: { hidden: true, hiddenReason: 'url-name' } }
    );
    const result = await classifyCollection(Token, false);
    expect(result.changes.map((c) => [c.address, c.from, c.to])).toEqual([
      [GOOD, 'hidden (url-name)', 'visible'],
    ]);
    expect((await Token.findOne({ address: GOOD }).lean())?.hidden).toBe(false);
  });
});
