/**
 * Blockscout v2 routes for tokens, holders, token transfers, per-address and
 * per-block lists, search and counters: the field names follow Blockscout,
 * `next_page_params` can be sent back as the next query, and nothing the
 * database does not hold is invented. mongodb-memory-server; the node is a spy.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  Account,
  Block,
  Contract,
  Token,
  TokenHolder,
  TokenTransfer,
  Transaction,
} from '@/models/index';
import { publicClient } from '@/lib/api/blockscout/shared';
import { GET as tokensGet } from '@/app/api/v2/tokens/route';
import { GET as tokenGet } from '@/app/api/v2/tokens/[address]/route';
import { GET as holdersGet } from '@/app/api/v2/tokens/[address]/holders/route';
import { GET as tokenTransfersGet } from '@/app/api/v2/tokens/[address]/transfers/route';
import { GET as tokenCountersGet } from '@/app/api/v2/tokens/[address]/counters/route';
import { GET as addressTokensGet } from '@/app/api/v2/addresses/[address]/tokens/route';
import { GET as addressTransfersGet } from '@/app/api/v2/addresses/[address]/token-transfers/route';
import { GET as addressCountersGet } from '@/app/api/v2/addresses/[address]/counters/route';
import { GET as addressTxsGet } from '@/app/api/v2/addresses/[address]/transactions/route';
import { GET as addressInternalGet } from '@/app/api/v2/addresses/[address]/internal-transactions/route';
import { GET as txsGet } from '@/app/api/v2/transactions/route';
import { GET as txTransfersGet } from '@/app/api/v2/transactions/[hash]/token-transfers/route';
import { GET as txLogsGet } from '@/app/api/v2/transactions/[hash]/logs/route';
import { GET as blockTxsGet } from '@/app/api/v2/blocks/[numberOrHash]/transactions/route';
import { GET as searchGet } from '@/app/api/v2/search/route';
import { GET as redirectGet } from '@/app/api/v2/search/check-redirect/route';
import { GET as contractsGet } from '@/app/api/v2/smart-contracts/route';

let mongod: MongoMemoryServer;
let ipCounter = 0;

const pad = (prefix: string, length: number) => `0x${prefix.padEnd(length, '0')}`;
const ALICE = pad('a11ce', 40);
const BOB = pad('b0b', 40);
const DEPLOYED = pad('c0de', 40);
const ZERO = pad('', 40);
const FUNGIBLE = pad('f001', 40);
const NFT = pad('f002', 40);
const SPAM = pad('f004', 40);
const TX_OK = pad('1', 64);
const TX_FAILED = pad('2', 64);
const TX_CREATE = pad('3', 64);
const TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const GENESIS_TIME = 1_760_000_000;
const HEAD = 10;

type Handler<P> = (request: NextRequest, context: { params: Promise<P> }) => Promise<Response>;

function request(path: string): NextRequest {
  ipCounter += 1;
  return new NextRequest(`https://explorer.example${path}`, {
    headers: { 'x-client-ip': `198.51.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` },
  });
}

async function call<P>(handler: Handler<P>, path: string, params: P) {
  const response = await handler(request(path), { params: Promise.resolve(params) });
  return { status: response.status, body: await response.json() };
}

async function list(handler: (request: NextRequest) => Promise<Response>, path: string) {
  const response = await handler(request(path));
  return { status: response.status, body: await response.json() };
}

/** The query a Blockscout client builds for the next page. */
const nextQuery = (params: Record<string, unknown>) =>
  new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)])
  ).toString();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('explorerDB_v2_lists');
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
  const time = (blockNumber: number) => GENESIS_TIME + blockNumber * 10;
  await Block.collection.insertMany(
    Array.from({ length: HEAD + 1 }, (_, number) => ({
      number,
      hash: pad(`b${number}`, 64),
      miner: BOB,
      timestamp: time(number),
    }))
  );
  const tx = (hash: string, blockNumber: number, transactionIndex: number, rest: object) => ({
    hash,
    blockNumber,
    transactionIndex,
    nonce: blockNumber,
    value: '0',
    gas: 90_000,
    gasUsed: 21_000,
    gasPrice: '1000000000',
    timestamp: time(blockNumber),
    input: '0x',
    status: 1,
    ...rest,
  });
  await Transaction.collection.insertMany([
    tx(TX_OK, 5, 0, { from: ALICE, to: BOB, value: '100' }),
    tx(TX_FAILED, 6, 0, { from: BOB, to: FUNGIBLE, status: 0, input: '0xa9059cbb00' }),
    tx(TX_CREATE, 6, 1, { from: ALICE, to: null, creates: DEPLOYED, input: '0x6080' }),
  ]);
  await Token.collection.insertMany([
    {
      address: FUNGIBLE,
      name: 'Good Token',
      symbol: 'GOOD',
      decimals: 6,
      totalSupply: '1000',
      holders: 2,
      type: 'VRC-20',
    },
    { address: NFT, name: 'Collectible', symbol: 'COL', decimals: 0, holders: 1, type: 'ERC721' },
    {
      address: SPAM,
      name: 'http://127.0.0.1/x',
      symbol: 'SPAM',
      holders: 9,
      type: 'ERC20',
      hidden: true,
    },
  ]);
  await Contract.collection.insertMany([
    {
      address: DEPLOYED,
      contractName: 'Vault',
      verified: true,
      compilerVersion: '0.8.28',
      optimization: true,
      verifiedAt: new Date('2026-11-01T00:00:00Z'),
    },
    { address: FUNGIBLE, contractName: 'GoodToken', verified: false },
  ]);
  await Account.collection.insertMany([{ address: NFT, balance: '0', type: 1 }]);
  await TokenHolder.collection.insertMany([
    { tokenAddress: FUNGIBLE, holderAddress: ALICE, balance: '900', rank: 1 },
    { tokenAddress: FUNGIBLE, holderAddress: BOB, balance: '100', rank: 2 },
    { tokenAddress: FUNGIBLE, holderAddress: DEPLOYED, balance: '0', rank: 3 },
    { tokenAddress: NFT, holderAddress: ALICE, balance: '2', rank: 1 },
    { tokenAddress: SPAM, holderAddress: ALICE, balance: '5000', rank: 1 },
  ]);
  const at = (blockNumber: number) => new Date(time(blockNumber) * 1000);
  await TokenTransfer.collection.insertMany([
    {
      tokenAddress: FUNGIBLE,
      transactionHash: TX_OK,
      from: ZERO,
      to: ALICE,
      value: '1000',
      blockNumber: 5,
      timestamp: at(5),
    },
    {
      tokenAddress: FUNGIBLE,
      transactionHash: TX_FAILED,
      from: ALICE,
      to: BOB,
      value: '100',
      blockNumber: 6,
      timestamp: at(6),
    },
    {
      tokenAddress: NFT,
      transactionHash: TX_CREATE,
      from: ZERO,
      to: ALICE,
      tokenId: 7,
      blockNumber: 6,
      timestamp: at(6),
    },
    {
      tokenAddress: SPAM,
      transactionHash: TX_CREATE,
      from: BOB,
      to: ALICE,
      value: '5000',
      blockNumber: 6,
      timestamp: at(6),
    },
  ]);
});

describe('tokens', () => {
  it('lists tokens by holders without the hidden ones, and pages with next_page_params', async () => {
    const first = await list(tokensGet, '/api/v2/tokens?limit=1');
    expect(first.body.items.map((token: { address_hash: string }) => token.address_hash)).toEqual([
      FUNGIBLE,
    ]);
    expect(first.body.items[0]).toMatchObject({
      name: 'Good Token',
      symbol: 'GOOD',
      decimals: '6',
      holders_count: '2',
      total_supply: '1000',
      type: 'ERC-20',
    });
    const second = await list(
      tokensGet,
      `/api/v2/tokens?${nextQuery(first.body.next_page_params)}`
    );
    expect(second.body.items.map((token: { address_hash: string }) => token.address_hash)).toEqual([
      NFT,
    ]);
    expect(second.body.next_page_params).toBeNull();
  });

  it('filters by type and by the start of the name or the address', async () => {
    const nfts = await list(tokensGet, '/api/v2/tokens?type=ERC-721');
    expect(nfts.body.items.map((token: { symbol: string }) => token.symbol)).toEqual(['COL']);
    const byName = await list(tokensGet, '/api/v2/tokens?q=goo');
    expect(byName.body.items.map((token: { symbol: string }) => token.symbol)).toEqual(['GOOD']);
    const byAddress = await list(tokensGet, `/api/v2/tokens?q=${NFT}`);
    expect(byAddress.body.items).toHaveLength(1);
    const pattern = await list(tokensGet, '/api/v2/tokens?q=.*');
    expect(pattern.body.items).toEqual([]);
  });

  it('returns one token, 404 for an unknown one and 400 for a malformed address', async () => {
    const found = await call(tokenGet, `/api/v2/tokens/${NFT}`, { address: NFT });
    expect(found.body).toMatchObject({ address_hash: NFT, type: 'ERC-721', decimals: '0' });
    const missing = await call(tokenGet, `/api/v2/tokens/${ALICE}`, { address: ALICE });
    expect(missing).toEqual({ status: 404, body: { message: 'Not found' } });
    const malformed = await call(tokenGet, '/api/v2/tokens/0x12', { address: '0x12' });
    expect(malformed.status).toBe(400);
  });

  it('lists holders by rank with address and token objects', async () => {
    const { body } = await call(holdersGet, `/api/v2/tokens/${FUNGIBLE}/holders`, {
      address: FUNGIBLE,
    });
    expect(body.items.map((holder: { value: string }) => holder.value)).toEqual(['900', '100']);
    expect(body.items[0]).toMatchObject({
      address: { hash: ALICE, is_contract: false },
      token: { address_hash: FUNGIBLE, symbol: 'GOOD' },
      token_id: null,
    });
    expect(body.next_page_params).toBeNull();
  });

  it('lists the transfers of a token with their kind', async () => {
    const { body } = await call(tokenTransfersGet, `/api/v2/tokens/${FUNGIBLE}/transfers`, {
      address: FUNGIBLE,
    });
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      transaction_hash: TX_FAILED,
      block_number: 6,
      type: 'token_transfer',
      token_type: 'ERC-20',
      total: { decimals: '6', value: '100' },
      from: { hash: ALICE },
      to: { hash: BOB },
    });
    expect(body.items[1]).toMatchObject({ type: 'token_minting', total: { value: '1000' } });
  });

  it('counts holders and transfers', async () => {
    const { body } = await call(tokenCountersGet, `/api/v2/tokens/${FUNGIBLE}/counters`, {
      address: FUNGIBLE,
    });
    expect(body).toEqual({ token_holders_count: '2', transfers_count: '2' });
  });
});

describe('addresses', () => {
  it('lists the tokens of an address, largest balance first', async () => {
    const all = await call(addressTokensGet, `/api/v2/addresses/${ALICE}/tokens`, {
      address: ALICE,
    });
    expect(all.body.items.map((row: { value: string }) => row.value)).toEqual(['900', '2']);
    expect(all.body.items[0]).toMatchObject({
      token: { address_hash: FUNGIBLE },
      token_id: null,
      token_instance: null,
    });
    const nfts = await call(addressTokensGet, `/api/v2/addresses/${ALICE}/tokens?type=ERC-721`, {
      address: ALICE,
    });
    expect(nfts.body.items.map((row: { token: { symbol: string } }) => row.token.symbol)).toEqual([
      'COL',
    ]);
  });

  it('lists token transfers of an address with the direction, type and token filters', async () => {
    const path = `/api/v2/addresses/${ALICE}/token-transfers`;
    const all = await call(addressTransfersGet, path, { address: ALICE });
    // the hidden token is left out
    expect(all.body.items).toHaveLength(3);
    const sent = await call(addressTransfersGet, `${path}?filter=from`, { address: ALICE });
    expect(sent.body.items.map((t: { transaction_hash: string }) => t.transaction_hash)).toEqual([
      TX_FAILED,
    ]);
    const nfts = await call(addressTransfersGet, `${path}?type=ERC-721`, { address: ALICE });
    expect(nfts.body.items).toHaveLength(1);
    expect(nfts.body.items[0]).toMatchObject({
      token_type: 'ERC-721',
      total: { token_id: '7', token_instance: null },
      type: 'token_minting',
    });
    const spam = await call(addressTransfersGet, `${path}?token=${SPAM}`, { address: ALICE });
    expect(spam.body.items).toHaveLength(1);
    const none = await call(addressTransfersGet, `${path}?type=ERC-1155`, { address: ALICE });
    expect(none.body).toEqual({ items: [], next_page_params: null });
  });

  it('counts transactions, token transfers, gas and mined blocks', async () => {
    const alice = await call(addressCountersGet, `/api/v2/addresses/${ALICE}/counters`, {
      address: ALICE,
    });
    expect(alice.body).toEqual({
      transactions_count: '2',
      token_transfers_count: '4',
      gas_usage_count: '42000',
      validations_count: '0',
    });
    const bob = await call(addressCountersGet, `/api/v2/addresses/${BOB}/counters`, {
      address: BOB,
    });
    expect(bob.body.validations_count).toBe(String(HEAD + 1));
  });

  it('lists the transactions of an address and never invents internal ones', async () => {
    const path = `/api/v2/addresses/${ALICE}/transactions`;
    const all = await call(addressTxsGet, path, { address: ALICE });
    expect(all.body.items.map((tx: { hash: string }) => tx.hash)).toEqual([TX_CREATE, TX_OK]);
    const received = await call(addressTxsGet, `${path}?filter=to`, { address: ALICE });
    expect(received.body.items).toEqual([]);
    const internal = await call(
      addressInternalGet as Handler<{ address: string }>,
      `/api/v2/addresses/${ALICE}/internal-transactions`,
      { address: ALICE }
    );
    expect(internal.body).toEqual({ items: [], next_page_params: null });
  });
});

describe('transactions and blocks', () => {
  it('lists transactions with the current and the older field names and real address facts', async () => {
    const { body } = await list(txsGet, '/api/v2/transactions');
    expect(body.items.map((tx: { hash: string }) => tx.hash)).toEqual([
      TX_CREATE,
      TX_FAILED,
      TX_OK,
    ]);
    const [creation, failed, ok] = body.items;
    expect(ok).toMatchObject({
      block_number: 5,
      block: 5,
      confirmations: 6,
      status: 'ok',
      result: 'success',
      transaction_types: ['coin_transfer'],
      tx_types: ['coin_transfer'],
      fee: { type: 'actual', value: '21000000000000' },
      gas_limit: '90000',
      gas_used: '21000',
      from: { hash: ALICE, is_contract: false },
      to: { hash: BOB, is_contract: false },
      created_contract: null,
      method: null,
    });
    expect(failed).toMatchObject({
      status: 'error',
      result: 'error',
      transaction_types: ['contract_call'],
      method: '0xa9059cbb',
      to: { hash: FUNGIBLE, is_contract: true, is_verified: false, name: 'GoodToken' },
    });
    expect(creation).toMatchObject({
      to: null,
      created_contract: { hash: DEPLOYED, is_contract: true, is_verified: true, name: 'Vault' },
      transaction_types: ['contract_creation'],
    });
  });

  it('does not call an address a contract because of a no-code token record', async () => {
    // an account that an earlier register API stored as a token
    await Token.collection.insertOne({
      address: ALICE,
      name: 'Unknown',
      symbol: 'UNKNOWN',
      type: 'VRC-20',
      hidden: true,
      hiddenReason: 'no-code',
    });
    const { body } = await list(txsGet, '/api/v2/transactions');
    const ok = body.items.find((tx: { hash: string }) => tx.hash === TX_OK);
    expect(ok.from).toMatchObject({ hash: ALICE, is_contract: false, name: null });
  });

  it('pages the transaction list with next_page_params and filters contract creations', async () => {
    const first = await list(txsGet, '/api/v2/transactions?limit=2');
    expect(first.body.next_page_params).toMatchObject({
      block_number: 6,
      index: 0,
      page: 2,
      limit: 2,
    });
    const second = await list(
      txsGet,
      `/api/v2/transactions?${nextQuery(first.body.next_page_params)}`
    );
    expect(second.body.items.map((tx: { hash: string }) => tx.hash)).toEqual([TX_OK]);
    expect(second.body.next_page_params).toBeNull();
    const creations = await list(txsGet, '/api/v2/transactions?type=contract_creation');
    expect(creations.body.items.map((tx: { hash: string }) => tx.hash)).toEqual([TX_CREATE]);
  });

  it('takes the block time for a transaction saved without its own', async () => {
    await Transaction.collection.insertOne({
      hash: pad('7', 64),
      blockNumber: 8,
      transactionIndex: 0,
      from: BOB,
      to: ALICE,
      value: '1',
      status: 1,
    });
    const { body } = await list(txsGet, '/api/v2/transactions?limit=1');
    expect(body.items[0]).toMatchObject({
      hash: pad('7', 64),
      timestamp: new Date((GENESIS_TIME + 80) * 1000).toISOString(),
      gas_used: null,
      fee: { type: 'actual', value: '0' },
    });
  });

  it('lists the transactions of a block by height or hash', async () => {
    const byNumber = await call(blockTxsGet, '/api/v2/blocks/6/transactions', {
      numberOrHash: '6',
    });
    expect(byNumber.body.items.map((tx: { hash: string }) => tx.hash)).toEqual([
      TX_CREATE,
      TX_FAILED,
    ]);
    const byHash = await call(blockTxsGet, `/api/v2/blocks/${pad('b5', 64)}/transactions`, {
      numberOrHash: pad('b5', 64),
    });
    expect(byHash.body.items.map((tx: { hash: string }) => tx.hash)).toEqual([TX_OK]);
    const missing = await call(blockTxsGet, '/api/v2/blocks/999/transactions', {
      numberOrHash: '999',
    });
    expect(missing.status).toBe(404);
  });

  it('returns the token transfers and the logs of a transaction', async () => {
    const transfers = await call(
      txTransfersGet,
      `/api/v2/transactions/${TX_CREATE}/token-transfers`,
      {
        hash: TX_CREATE,
      }
    );
    expect(transfers.body.items).toHaveLength(2);
    const unknown = await call(
      txTransfersGet,
      `/api/v2/transactions/${pad('9', 64)}/token-transfers`,
      {
        hash: pad('9', 64),
      }
    );
    expect(unknown.status).toBe(404);

    vi.spyOn(publicClient, 'request').mockResolvedValue({
      logs: [
        {
          address: FUNGIBLE,
          blockHash: pad('b6', 64),
          blockNumber: '0x6',
          data: '0x01',
          logIndex: '0x2',
          topics: [TOPIC, pad('a11ce', 64)],
          transactionHash: TX_FAILED,
        },
      ],
    } as never);
    const logs = await call(txLogsGet, `/api/v2/transactions/${TX_FAILED}/logs`, {
      hash: TX_FAILED,
    });
    expect(logs.body.items).toEqual([
      expect.objectContaining({
        address: expect.objectContaining({ hash: FUNGIBLE, is_contract: true }),
        block_number: 6,
        data: '0x01',
        index: 2,
        topics: [TOPIC, pad('a11ce', 64), null, null],
        transaction_hash: TX_FAILED,
      }),
    ]);
  });
});

describe('search and contracts', () => {
  it('finds an address, a token by name, a transaction and a block', async () => {
    const token = await list(searchGet, `/api/v2/search?q=${FUNGIBLE}`);
    expect(token.body.items.map((item: { type: string }) => item.type)).toEqual([
      'token',
      'contract',
    ]);
    const wallet = await list(searchGet, `/api/v2/search?q=${ALICE}`);
    expect(wallet.body.items).toMatchObject([{ type: 'address', address_hash: ALICE }]);
    const byName = await list(searchGet, '/api/v2/search?q=coll');
    expect(byName.body.items).toMatchObject([
      { type: 'token', address_hash: NFT, token_type: 'ERC-721', token_url: `/token/${NFT}` },
    ]);
    const tx = await list(searchGet, `/api/v2/search?q=${TX_OK}`);
    expect(tx.body.items).toMatchObject([{ type: 'transaction', transaction_hash: TX_OK }]);
    const block = await list(searchGet, '/api/v2/search?q=7');
    expect(block.body.items).toMatchObject([{ type: 'block', block_number: 7 }]);
    // the hidden token is not found by its name
    const hidden = await list(searchGet, '/api/v2/search?q=http');
    expect(hidden.body.items).toEqual([]);
  });

  it('tells whether a search term names one page', async () => {
    const tx = await list(redirectGet, `/api/v2/search/check-redirect?q=${TX_OK}`);
    expect(tx.body).toEqual({ parameter: TX_OK, redirect: true, type: 'transaction' });
    const block = await list(redirectGet, '/api/v2/search/check-redirect?q=3');
    expect(block.body).toEqual({ parameter: '3', redirect: true, type: 'block' });
    const none = await list(redirectGet, '/api/v2/search/check-redirect?q=good');
    expect(none.body).toEqual({ parameter: null, redirect: false, type: null });
  });

  it('lists verified contracts', async () => {
    const { body } = await list(contractsGet, '/api/v2/smart-contracts');
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      address: { hash: DEPLOYED, is_verified: true, name: 'Vault' },
      compiler_version: 'v0.8.28',
      optimization_enabled: true,
      language: 'solidity',
    });
  });
});
