/**
 * /api/v2/addresses/[address]/token-balances: the Blockscout-format list of the
 * tokens an address holds, served from tokenholders / tokens, and the
 * `has_tokens` flag of /api/v2/addresses/[address]. mongodb-memory-server; no node.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Token, TokenHolder } from '@/models/index';
import { GET as tokenBalancesGet } from '@/app/api/v2/addresses/[address]/token-balances/route';

type AddressHandler = (
  request: NextRequest,
  context: { params: Promise<{ address: string }> }
) => Promise<Response>;

let addressGet: AddressHandler;
let mongod: MongoMemoryServer;
let ipCounter = 10;

const HOLDER = '0x00000000000000000000000000000000000000aa';
const OTHER_HOLDER = '0x00000000000000000000000000000000000000bb';
const SPAM_ONLY_HOLDER = '0x00000000000000000000000000000000000000cc';
const FUNGIBLE = '0x1000000000000000000000000000000000000001';
const NFT = '0x2000000000000000000000000000000000000002';
const SPAM = '0x3000000000000000000000000000000000000003';
const SPENT = '0x4000000000000000000000000000000000000004';
const UNLISTED = '0x5000000000000000000000000000000000000005';
const MALFORMED = '0x6000000000000000000000000000000000000006';

function call(handler: AddressHandler, address: string, suffix = ''): Promise<Response> {
  ipCounter += 1;
  const request = new NextRequest(`https://explorer.example/api/v2/addresses/${address}${suffix}`, {
    headers: { 'x-client-ip': `198.51.100.${ipCounter % 250}` },
  });
  return handler(request, { params: Promise.resolve({ address }) });
}

const tokenBalances = (address: string) => call(tokenBalancesGet, address, '/token-balances');

beforeAll(async () => {
  // The address route creates a Web3 instance on import: point it at a closed port
  process.env.WEB3_PROVIDER_URL = 'http://127.0.0.1:1';
  addressGet = (await import('@/app/api/v2/addresses/[address]/route')).GET;
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('explorerDB_token_balances');
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
  await Token.collection.insertMany([
    {
      address: FUNGIBLE,
      name: 'Good Token',
      symbol: 'GOOD',
      decimals: 6,
      totalSupply: '1000000000',
      holders: 3,
      type: 'VRC-20',
      logoUrl: 'https://explorer.example/img/GOOD.svg',
    },
    { address: NFT, name: 'Collectible', symbol: 'COL', decimals: 0, holders: 2, type: 'ERC721' },
    {
      address: SPAM,
      name: 'http://127.0.0.1:2375/version',
      symbol: 'SPAM',
      type: 'ERC20',
      hidden: true,
      hiddenReason: 'url-name',
    },
    { address: SPENT, name: 'Spent', symbol: 'SPENT', decimals: 18, type: 'ERC20' },
  ]);
  await TokenHolder.collection.insertMany([
    { tokenAddress: FUNGIBLE, holderAddress: HOLDER, balance: '2500000', percentage: 1, rank: 1 },
    { tokenAddress: NFT, holderAddress: HOLDER, balance: '3', percentage: 30, rank: 1 },
    { tokenAddress: SPAM, holderAddress: HOLDER, balance: '5', percentage: 1, rank: 1 },
    { tokenAddress: SPENT, holderAddress: HOLDER, balance: '0', percentage: 0, rank: 9 },
    { tokenAddress: UNLISTED, holderAddress: HOLDER, balance: '7', percentage: 1, rank: 1 },
    { tokenAddress: MALFORMED, holderAddress: HOLDER, balance: '1e18', percentage: 1, rank: 1 },
    { tokenAddress: FUNGIBLE, holderAddress: OTHER_HOLDER, balance: '99', percentage: 1, rank: 2 },
    { tokenAddress: SPAM, holderAddress: SPAM_ONLY_HOLDER, balance: '5', percentage: 1, rank: 2 },
  ]);
});

describe('GET /api/v2/addresses/[address]/token-balances', () => {
  it('rejects an invalid address', async () => {
    const response = await tokenBalances('0x1234');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: 'Invalid address' });
  });

  it('returns an empty array for an address without holdings', async () => {
    const response = await tokenBalances('0x00000000000000000000000000000000000000dd');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it('returns an empty array when the only holding is a hidden token', async () => {
    const response = await tokenBalances(SPAM_ONLY_HOLDER);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it('lists one row per held token in the Blockscout shape', async () => {
    const response = await tokenBalances(HOLDER);
    expect(response.status).toBe(200);
    const items = await response.json();

    // zero balance, hidden (spam) and malformed balances are left out; ordered by token address
    expect(
      items.map((item: { token: { address_hash: string } }) => item.token.address_hash)
    ).toEqual([FUNGIBLE, NFT, UNLISTED]);
    expect(items[0]).toEqual({
      token: {
        address_hash: FUNGIBLE,
        address: FUNGIBLE,
        circulating_market_cap: null,
        decimals: '6',
        exchange_rate: null,
        holders_count: '3',
        holders: '3',
        icon_url: null,
        name: 'Good Token',
        symbol: 'GOOD',
        total_supply: '1000000000',
        type: 'ERC-20',
        volume_24h: null,
      },
      token_id: null,
      token_instance: null,
      value: '2500000',
    });
    // an NFT collection is one row with the number of items held
    expect(items[1].token).toMatchObject({ type: 'ERC-721', decimals: '0', total_supply: null });
    expect(items[1].value).toBe('3');
    // a held token that has no tokens document is still reported
    expect(items[2].token).toMatchObject({
      address_hash: UNLISTED,
      name: null,
      symbol: null,
      decimals: null,
      holders_count: null,
      type: 'ERC-20',
    });
    expect(items[2].value).toBe('7');
  });

  it('accepts a mixed-case address', async () => {
    const response = await tokenBalances(HOLDER.replace('aa', 'AA'));
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(3);
  });

  it('only reports the holdings of the requested address', async () => {
    const items = await (await tokenBalances(OTHER_HOLDER)).json();
    expect(items).toHaveLength(1);
    expect(items[0].token.address_hash).toBe(FUNGIBLE);
    expect(items[0].value).toBe('99');
  });

  it('gives a token discovery client what it reads', async () => {
    // DefiLlama's token helper: token.address_hash (or .address), token.type, value
    const items = await (await tokenBalances(HOLDER)).json();
    const discovered: Record<string, { type: string; hasValue: boolean }> = {};
    for (const item of items) {
      const address = (item?.token?.address_hash ?? item?.token?.address)?.toLowerCase();
      discovered[address] = { type: item?.token?.type, hasValue: +(item?.value ?? 0) > 0 };
    }
    expect(discovered).toEqual({
      [FUNGIBLE]: { type: 'ERC-20', hasValue: true },
      [NFT]: { type: 'ERC-721', hasValue: true },
      [UNLISTED]: { type: 'ERC-20', hasValue: true },
    });
  });
});

describe('GET /api/v2/addresses/[address] has_tokens', () => {
  it('is true for an address with a token balance', async () => {
    const response = await call(addressGet, HOLDER);
    expect(response.status).toBe(200);
    expect((await response.json()).has_tokens).toBe(true);
  });

  it('is false for an address without one', async () => {
    const response = await call(addressGet, '0x00000000000000000000000000000000000000dd');
    expect(response.status).toBe(200);
    expect((await response.json()).has_tokens).toBe(false);
  });
});
