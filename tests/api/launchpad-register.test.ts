/**
 * Launchpad registration and sync APIs against mongodb-memory-server and a
 * mock JSON-RPC node: only factory-vouched tokens are registered, the creator
 * comes from the chain (the request body is ignored), GET sync never writes,
 * POST sync imports and honours the cooldown.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  CREATOR,
  FACTORIES,
  FakeFactoryWorld,
  LEGACY_FACTORY,
  OTHER_CREATOR,
  V2_FACTORY,
  startFakeNode,
} from '../launchpad/fake-factory';

const state = vi.hoisted(() => ({ rpcUrl: '' }));

vi.mock('@/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config')>();
  const fake = () =>
    ({
      ...actual.readConfig(),
      web3Provider: { url: state.rpcUrl },
      launchpad: {
        enabled: true,
        factoryAddress: '0x5b6c68456d8e79194c63514390884e8b541298c4',
        legacyFactories: [{ address: '0x1111111111111111111111111111111111111111', version: 'v1' }],
        creationFee: '0',
      },
    }) as ReturnType<typeof actual.readConfig>;
  return {
    ...actual,
    readConfig: fake,
    loadConfig: fake,
    getWeb3ProviderURL: () => state.rpcUrl,
  };
});

import { Token, TokenHolder, ScanProgress } from '@/models/index';
import { resetWeb3 } from '@/lib/web3/provider';
import { POST as registerPost } from '@/app/api/launchpad/register/route';
import { GET as syncGet, POST as syncPost } from '@/app/api/launchpad/sync/route';
import { LAUNCHPAD_SYNC_SCAN_TYPE } from '@/lib/launchpad/sync';

const V2_TOKEN = '0xaaaa000000000000000000000000000000000001';
const LEGACY_TOKEN = '0xbbbb000000000000000000000000000000000002';
const STRANGER = '0xcccc000000000000000000000000000000000003';

let mongod: MongoMemoryServer;
let node: Awaited<ReturnType<typeof startFakeNode>>;
let world: FakeFactoryWorld;
let ipCounter = 1;

function request(
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {}
): NextRequest {
  ipCounter += 1;
  return new NextRequest(`https://explorer.example${path}`, {
    method: init.method,
    body: init.body,
    headers: {
      'content-type': 'application/json',
      'x-client-ip': `203.0.113.${ipCounter % 250}`,
      ...init.headers,
    },
  });
}

function post(path: string, body: unknown): NextRequest {
  return request(path, { method: 'POST', body: JSON.stringify(body) });
}

beforeAll(async () => {
  world = new FakeFactoryWorld();
  node = await startFakeNode(world);
  state.rpcUrl = node.url;
  resetWeb3();
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('explorerDB_launchpad');
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
  if (node) await node.close();
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
  world.tokens.clear();
  world.calls.length = 0;
  world.addToken({
    address: V2_TOKEN,
    factory: V2_FACTORY,
    name: 'Sample Token',
    symbol: 'SMP',
    decimals: 18,
    recordedSupply: 1_000n,
    liveSupply: 1_000n,
    createdAt: 1_761_600_000,
    logoUrl: 'https://explorer.example/img/SMP.svg',
    balances: { [CREATOR]: 600n },
  });
  world.addToken({
    address: LEGACY_TOKEN,
    factory: LEGACY_FACTORY,
    name: 'Old Token',
    symbol: 'OLD',
    recordedSupply: 5n,
    liveSupply: 5n,
    balances: { [CREATOR]: 5n },
  });
});

describe('POST /api/launchpad/register', () => {
  it('answers 404 for an address no factory knows and writes nothing', async () => {
    const res = await registerPost(
      post('/api/launchpad/register', { tokenAddress: STRANGER }),
      undefined
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FACTORY_TOKEN');
    expect(await Token.countDocuments()).toBe(0);
    expect(await TokenHolder.countDocuments()).toBe(0);
  });

  it('rejects malformed input', async () => {
    expect((await registerPost(post('/api/launchpad/register', {}), undefined)).status).toBe(400);
    expect(
      (await registerPost(post('/api/launchpad/register', { tokenAddress: '0x1234' }), undefined))
        .status
    ).toBe(400);
    const broken = request('/api/launchpad/register', { method: 'POST', body: '{not json' });
    expect((await registerPost(broken, undefined)).status).toBe(400);
  });

  it('registers a factory token with the chain creator and balance, ignoring body.creator', async () => {
    const res = await registerPost(
      post('/api/launchpad/register', {
        tokenAddress: V2_TOKEN.toUpperCase().replace('0X', '0x'),
        creator: OTHER_CREATOR,
        name: 'Attacker Name',
        totalSupply: '999999999',
      }),
      undefined
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.token).toMatchObject({
      address: V2_TOKEN,
      name: 'Sample Token',
      symbol: 'SMP',
      creator: CREATOR,
      factory: V2_FACTORY,
      factoryVerified: true,
      totalSupply: '1000',
    });

    const stored = (await Token.findOne({ address: V2_TOKEN }).lean()) as Record<string, unknown>;
    expect(stored.createdBy).toBe(CREATOR);
    expect(stored.name).toBe('Sample Token');
    expect(stored.totalSupply).toBe('1000');
    expect(stored.source).toBe('launchpad');
    expect(stored.factoryVerified).toBe(true);
    expect(stored.holders).toBe(1);
    expect(stored.hidden).toBe(false);
    expect((stored.createdAt as Date).toISOString()).toBe(
      new Date(1_761_600_000 * 1000).toISOString()
    );

    const holder = (await TokenHolder.findOne({ tokenAddress: V2_TOKEN }).lean()) as Record<
      string,
      unknown
    >;
    expect(holder.holderAddress).toBe(CREATOR);
    expect(holder.balance).toBe('600');
    expect(holder.percentage).toBe(60);
    expect(await TokenHolder.countDocuments({ holderAddress: OTHER_CREATOR })).toBe(0);
  });

  it('is idempotent: registering again returns 200 and the stored record without duplicates', async () => {
    const first = await registerPost(
      post('/api/launchpad/register', { tokenAddress: V2_TOKEN }),
      undefined
    );
    expect(first.status).toBe(200);
    const second = await registerPost(
      post('/api/launchpad/register', { tokenAddress: V2_TOKEN }),
      undefined
    );
    expect(second.status).toBe(200);
    expect((await second.json()).message).toBe('Token already registered');
    expect(await Token.countDocuments({ address: V2_TOKEN })).toBe(1);
    expect(await TokenHolder.countDocuments({ tokenAddress: V2_TOKEN })).toBe(1);
  });

  it('accepts legacy-factory tokens through the getAllTokens fallback', async () => {
    const res = await registerPost(
      post('/api/launchpad/register', { tokenAddress: LEGACY_TOKEN }),
      undefined
    );
    expect(res.status).toBe(200);
    expect((await res.json()).token).toMatchObject({ factory: LEGACY_FACTORY, creator: CREATOR });
  });

  it('flags URL-like names as hidden while still registering the token', async () => {
    world.addToken({
      address: STRANGER,
      factory: V2_FACTORY,
      name: 'http://127.0.0.1:2375/version',
      symbol: 'X',
    });
    const res = await registerPost(
      post('/api/launchpad/register', { tokenAddress: STRANGER }),
      undefined
    );
    expect(res.status).toBe(200);
    const stored = (await Token.findOne({ address: STRANGER }).lean()) as Record<string, unknown>;
    expect(stored.hidden).toBe(true);
    expect(stored.hiddenReason).toBe('url-name');
  });
});

describe('/api/launchpad/sync', () => {
  it('GET is read-only: it reports status and changes nothing', async () => {
    const before = [await Token.countDocuments(), await TokenHolder.countDocuments()];
    const res = await syncGet(request('/api/launchpad/sync'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      configured: true,
      lastSyncAt: null,
      lastResult: null,
    });
    expect(body.factories.map((f: { address: string }) => f.address)).toEqual(
      FACTORIES.map((f) => f.address)
    );
    expect([await Token.countDocuments(), await TokenHolder.countDocuments()]).toEqual(before);
    expect(await ScanProgress.countDocuments()).toBe(0);
  });

  it("POST imports the factories' tokens with chain values, then GET shows the run", async () => {
    const res = await syncPost(post('/api/launchpad/sync', {}), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.results).toMatchObject({ factories: 2, total: 2, registered: 2, errors: 0 });
    expect(await Token.countDocuments()).toBe(2);
    const legacy = (await Token.findOne({ address: LEGACY_TOKEN }).lean()) as Record<
      string,
      unknown
    >;
    expect(legacy.createdBy).toBe(CREATOR);
    expect(legacy.factory).toBe(LEGACY_FACTORY);
    expect(legacy.factoryVerified).toBe(true);

    const status = await (await syncGet(request('/api/launchpad/sync'))).json();
    expect(status.lastSyncAt).not.toBeNull();
    expect(status.lastResult).toMatchObject({ registered: 2 });

    // a second manual run inside the cooldown is refused
    const again = await syncPost(post('/api/launchpad/sync', {}), undefined);
    expect(again.status).toBe(429);
    expect(again.headers.get('Retry-After')).toMatch(/^\d+$/);

    // ... and a sync older than the cooldown is allowed again (nothing new to import)
    await ScanProgress.updateOne(
      { scanType: LAUNCHPAD_SYNC_SCAN_TYPE },
      { $set: { lastUpdateTime: new Date(Date.now() - 120_000) } }
    );
    const later = await syncPost(post('/api/launchpad/sync', {}), undefined);
    expect(later.status).toBe(200);
    expect((await later.json()).results).toMatchObject({ registered: 0, unchanged: 2 });
    expect(await Token.countDocuments()).toBe(2);
  });

  it('POST marks a previously unverified DB token as factory-verified without touching its data', async () => {
    await Token.collection.insertOne({
      address: V2_TOKEN,
      name: 'Hand-edited name',
      symbol: 'SMP',
      type: 'VRC-20',
      source: 'launchpad',
      createdBy: OTHER_CREATOR,
      holders: 3,
      supply: '1000',
    });
    const res = await syncPost(post('/api/launchpad/sync', {}), undefined);
    expect(res.status).toBe(200);
    expect((await res.json()).results).toMatchObject({ registered: 1, updated: 1 });
    const stored = (await Token.findOne({ address: V2_TOKEN }).lean()) as Record<string, unknown>;
    expect(stored.name).toBe('Hand-edited name');
    expect(stored.createdBy).toBe(OTHER_CREATOR); // existing attribution is not rewritten by the sync
    expect(stored.factoryVerified).toBe(true);
    expect(stored.factory).toBe(V2_FACTORY);
  });
});
