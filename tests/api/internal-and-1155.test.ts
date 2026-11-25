/**
 * Internal transactions and VRC-1155 transfers in the compatible APIs:
 * Etherscan / Blockscout `txlistinternal` and `token1155tx`, the Blockscout v2
 * internal transaction lists, `has_error_in_internal_transactions`, the
 * transaction detail, per-id VRC-1155 balances and the type filter of token
 * transfers. mongodb-memory-server.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  Block,
  InternalTransaction,
  ScanProgress,
  Token,
  TokenHolder,
  TokenTransfer,
  Transaction,
} from '@/models/index';
import { GET as etherscanGet } from '@/app/api/route';
import { GET as txGet } from '@/app/api/v2/transactions/[hash]/route';
import { GET as txInternalGet } from '@/app/api/v2/transactions/[hash]/internal-transactions/route';
import { GET as addressInternalGet } from '@/app/api/v2/addresses/[address]/internal-transactions/route';
import { GET as blockInternalGet } from '@/app/api/v2/blocks/[numberOrHash]/internal-transactions/route';
import { GET as internalGet } from '@/app/api/v2/internal-transactions/route';
import { GET as balancesGet } from '@/app/api/v2/addresses/[address]/token-balances/route';
import { GET as addressTransfersGet } from '@/app/api/v2/addresses/[address]/token-transfers/route';
import { GET as txListGet } from '@/app/api/v2/transactions/route';

let mongod: MongoMemoryServer;
let ipCounter = 0;

const pad = (prefix: string, length: number) => `0x${prefix.padEnd(length, '0')}`;
const ALICE = pad('a11ce', 40);
const BOB = pad('b0b', 40);
const CAROL = pad('ca401', 40);
const DAVE = pad('da4e', 40);
const DEPLOYED = pad('c0de', 40);
const ZERO = pad('', 40);
const NFT = pad('f002', 40);
const MULTI = pad('e1155', 40);
const TX_OK = pad('1', 64);
const TX_FAILED = pad('2', 64);
const TX_CREATE = pad('3', 64);
const TX_OTHER = pad('4', 64);
const TX_LATE = pad('5', 64);
const BIG_ID = (2n ** 200n + 1n).toString();
const GENESIS_TIME = 1_760_000_000;
const time = (block: number) => GENESIS_TIME + block * 10;

type Handler<P> = (request: NextRequest, context: { params: Promise<P> }) => Promise<Response>;

function request(path: string): NextRequest {
  ipCounter += 1;
  return new NextRequest(`https://explorer.example${path}`, {
    headers: { 'x-client-ip': `203.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` },
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
const etherscan = (query: string) => list(etherscanGet, `/api?${query}`);

const internal = (
  transactionHash: string,
  blockNumber: number,
  transactionIndex: number,
  index: number,
  rest: object
) => ({
  transactionHash,
  index,
  traceAddress: [index - 1],
  blockNumber,
  blockHash: pad(`b${blockNumber}`, 64),
  transactionIndex,
  timestamp: time(blockNumber),
  type: 'call',
  callType: 'call',
  value: '0',
  gas: '50000',
  gasUsed: '100',
  error: null,
  reverted: false,
  to: null,
  ...rest,
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('explorerDB_internal_api');
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
  await Block.collection.insertMany(
    Array.from({ length: 11 }, (_, number) => ({
      number,
      hash: pad(`b${number}`, 64),
      timestamp: time(number),
    }))
  );
  const tx = (hash: string, blockNumber: number, rest: object) => ({
    hash,
    blockNumber,
    blockHash: pad(`b${blockNumber}`, 64),
    transactionIndex: 0,
    nonce: blockNumber,
    value: '0',
    gas: 90_000,
    gasUsed: 50_000,
    gasPrice: '1000000000',
    timestamp: time(blockNumber),
    input: '0x12345678',
    status: 1,
    ...rest,
  });
  await Transaction.collection.insertMany([
    tx(TX_OK, 5, { from: ALICE, to: BOB }),
    tx(TX_FAILED, 6, { from: ALICE, to: DAVE, status: 0 }),
    tx(TX_CREATE, 7, { from: ALICE, to: null, creates: DEPLOYED }),
    tx(TX_OTHER, 8, { from: ALICE, to: DEPLOYED }),
    tx(TX_LATE, 9, { from: ALICE, to: BOB }),
  ]);
  await InternalTransaction.collection.insertMany([
    internal(TX_OK, 5, 0, 1, { callType: 'staticcall', from: BOB, to: CAROL }),
    internal(TX_OK, 5, 0, 2, { from: BOB, to: CAROL, value: '70', gasUsed: '0' }),
    internal(TX_FAILED, 6, 0, 1, {
      from: DAVE,
      to: BOB,
      value: '5',
      error: 'Reverted',
      reverted: true,
    }),
    {
      ...internal(TX_FAILED, 6, 0, 2, {
        type: 'create',
        callType: null,
        from: BOB,
        error: 'Bad instruction',
        reverted: true,
        gasUsed: null,
      }),
      traceAddress: [0, 0],
    },
    {
      ...internal(TX_CREATE, 7, 0, 0, {
        type: 'create',
        callType: null,
        from: ALICE,
        createdContract: DEPLOYED,
      }),
      traceAddress: [],
    },
    internal(TX_OTHER, 8, 0, 1, {
      type: 'selfdestruct',
      callType: null,
      from: DEPLOYED,
      to: CAROL,
      value: '9',
      gas: '0',
      gasUsed: null,
    }),
  ]);
  // the indexer has covered blocks up to 8; TX_LATE (block 9) is not indexed yet
  await ScanProgress.collection.insertOne({
    scanType: 'internal-transactions',
    lastScannedBlock: 8,
  });

  await Token.collection.insertMany([
    { address: NFT, name: 'Collectible', symbol: 'COL', decimals: 0, type: 'VRC-721', holders: 1 },
    {
      address: MULTI,
      name: 'Game Items',
      symbol: 'ITEM',
      decimals: 0,
      type: 'VRC-1155',
      holders: 2,
    },
  ]);
  const at = (block: number) => new Date(time(block) * 1000);
  await TokenTransfer.collection.insertMany([
    {
      tokenAddress: NFT,
      transactionHash: TX_OK,
      from: ZERO,
      to: ALICE,
      tokenId: 7,
      blockNumber: 5,
      timestamp: at(5),
    },
    {
      tokenType: 'VRC-1155',
      tokenAddress: MULTI,
      transactionHash: TX_OK,
      logIndex: 3,
      batchIndex: 0,
      operator: ALICE,
      from: ZERO,
      to: ALICE,
      tokenId: BIG_ID,
      value: '5',
      blockNumber: 5,
      timestamp: at(5),
    },
    {
      tokenType: 'VRC-1155',
      tokenAddress: MULTI,
      transactionHash: TX_OTHER,
      logIndex: 1,
      batchIndex: 0,
      operator: ALICE,
      from: ZERO,
      to: ALICE,
      tokenId: '2',
      value: '7',
      blockNumber: 8,
      timestamp: at(8),
    },
    {
      tokenType: 'VRC-1155',
      tokenAddress: MULTI,
      transactionHash: TX_OTHER,
      logIndex: 2,
      batchIndex: 0,
      operator: ALICE,
      from: ALICE,
      to: BOB,
      tokenId: '2',
      value: '7',
      blockNumber: 8,
      timestamp: at(8),
    },
  ]);
  await TokenHolder.collection.insertMany([
    { tokenAddress: NFT, holderAddress: ALICE, balance: '1', rank: 1 },
    { tokenAddress: MULTI, holderAddress: ALICE, balance: '5', rank: 1 },
    { tokenAddress: MULTI, holderAddress: BOB, balance: '7', rank: 2 },
  ]);
});

describe('account/txlistinternal', () => {
  it('lists the value transfers of a transaction', async () => {
    const { body } = await etherscan(`module=account&action=txlistinternal&txhash=${TX_OK}`);
    expect(body.status).toBe('1');
    expect(body.result).toEqual([
      {
        blockNumber: '5',
        timeStamp: String(time(5)),
        hash: TX_OK,
        transactionHash: TX_OK,
        from: BOB,
        to: CAROL,
        value: '70',
        contractAddress: '',
        input: '',
        type: 'call',
        callType: 'call',
        gas: '50000',
        gasUsed: '0',
        traceId: '1',
        index: '2',
        isError: '0',
        errCode: '',
      },
    ]);
  });

  it('lists what an address sent, received or was created by, newest first', async () => {
    const carol = await etherscan(`module=account&action=txlistinternal&address=${CAROL}`);
    expect(
      carol.body.result.map((row: { hash: string; type: string }) => [row.hash, row.type])
    ).toEqual([
      [TX_OTHER, 'selfdestruct'],
      [TX_OK, 'call'],
    ]);
    const deployed = await etherscan(
      `module=account&action=txlistinternal&address=${DEPLOYED}&sort=asc`
    );
    expect(deployed.body.result).toMatchObject([
      {
        hash: TX_CREATE,
        type: 'create',
        contractAddress: DEPLOYED,
        to: '',
        value: '0',
        traceId: '0',
      },
      { hash: TX_OTHER, type: 'selfdestruct', from: DEPLOYED, to: CAROL, value: '9' },
    ]);
  });

  it('reports the calls of a failed transaction as errors, also below the failing call', async () => {
    const { body } = await etherscan(
      'module=account&action=txlistinternal&startblock=6&endblock=6&sort=asc'
    );
    expect(body.result).toMatchObject([
      { hash: TX_FAILED, value: '5', isError: '1', errCode: 'Reverted', traceId: '0' },
      { hash: TX_FAILED, type: 'create', isError: '1', errCode: 'Bad instruction', traceId: '0_0' },
    ]);
  });

  it('needs a transaction, an address or a block range', async () => {
    const { body } = await etherscan('module=account&action=txlistinternal');
    expect(body.status).toBe('0');
    expect(body.message).toContain('Missing address, txhash or startblock');
    const empty = await etherscan(`module=account&action=txlistinternal&address=${ZERO}`);
    expect(empty.body).toEqual({ status: '0', message: 'No transactions found', result: [] });
  });
});

describe('account token transfers by standard', () => {
  it('token1155tx returns VRC-1155 transfers with the id and the amount', async () => {
    const { body } = await etherscan(`module=account&action=token1155tx&address=${ALICE}&sort=asc`);
    expect(body.result).toHaveLength(3);
    expect(body.result[0]).toMatchObject({
      hash: TX_OK,
      contractAddress: MULTI,
      from: ZERO,
      to: ALICE,
      tokenID: BIG_ID,
      tokenValue: '5',
      tokenName: 'Game Items',
      tokenSymbol: 'ITEM',
    });
    expect(body.result[0]).not.toHaveProperty('tokenDecimal');
    expect(body.result[0]).not.toHaveProperty('value');
  });

  it('keeps VRC-1155 transfers out of tokennfttx and tokentx', async () => {
    const nft = await etherscan(`module=account&action=tokennfttx&address=${ALICE}`);
    expect(nft.body.result.map((row: { contractAddress: string }) => row.contractAddress)).toEqual([
      NFT,
    ]);
    const fungible = await etherscan(`module=account&action=tokentx&address=${ALICE}`);
    expect(fungible.body).toEqual({ status: '0', message: 'No transactions found', result: [] });
  });
});

describe('v2 internal transactions', () => {
  it('lists the frames of a transaction in trace order with Blockscout fields', async () => {
    const { status, body } = await call(
      txInternalGet as Handler<{ hash: string }>,
      `/api/v2/transactions/${TX_OK}/internal-transactions`,
      { hash: TX_OK }
    );
    expect(status).toBe(200);
    expect(body.next_page_params).toBeNull();
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      block_number: 5,
      transaction_hash: TX_OK,
      transaction_index: 0,
      index: 1,
      type: 'staticcall',
      success: true,
      error: null,
      value: '0',
      gas_limit: '50000',
      from: { hash: BOB },
      to: { hash: CAROL },
      created_contract: null,
      timestamp: new Date(time(5) * 1000).toISOString(),
    });
    expect(body.items[1]).toMatchObject({ index: 2, type: 'call', value: '70' });
  });

  it('answers 404 for an unknown transaction and reports failed frames', async () => {
    const unknown = await call(
      txInternalGet as Handler<{ hash: string }>,
      `/api/v2/transactions/${pad('9', 64)}/internal-transactions`,
      { hash: pad('9', 64) }
    );
    expect(unknown.status).toBe(404);
    const failed = await call(
      txInternalGet as Handler<{ hash: string }>,
      `/api/v2/transactions/${TX_FAILED}/internal-transactions`,
      { hash: TX_FAILED }
    );
    expect(
      failed.body.items.map((item: { type: string; success: boolean; error: string }) => [
        item.type,
        item.success,
        item.error,
      ])
    ).toEqual([
      ['call', false, 'Reverted'],
      ['create', false, 'Bad instruction'],
    ]);
  });

  it('lists the internal transactions of an address with the direction filter', async () => {
    const path = `/api/v2/addresses/${CAROL}/internal-transactions`;
    const all = await call(addressInternalGet as Handler<{ address: string }>, path, {
      address: CAROL,
    });
    expect(
      all.body.items.map((item: { transaction_hash: string; index: number }) => [
        item.transaction_hash,
        item.index,
      ])
    ).toEqual([
      [TX_OTHER, 1],
      [TX_OK, 2],
      [TX_OK, 1],
    ]);
    const sent = await call(
      addressInternalGet as Handler<{ address: string }>,
      `${path}?filter=from`,
      {
        address: CAROL,
      }
    );
    expect(sent.body.items).toEqual([]);
    const created = await call(
      addressInternalGet as Handler<{ address: string }>,
      `/api/v2/addresses/${DEPLOYED}/internal-transactions?filter=to`,
      { address: DEPLOYED }
    );
    expect(created.body.items).toMatchObject([
      { type: 'create', created_contract: { hash: DEPLOYED, is_contract: true } },
    ]);
  });

  it('lists a block in order and the whole chain newest first, with next_page_params', async () => {
    const block = await call(
      blockInternalGet as Handler<{ numberOrHash: string }>,
      '/api/v2/blocks/6/internal-transactions',
      { numberOrHash: '6' }
    );
    expect(block.body.items.map((item: { index: number }) => item.index)).toEqual([1, 2]);
    const missing = await call(
      blockInternalGet as Handler<{ numberOrHash: string }>,
      '/api/v2/blocks/99/internal-transactions',
      { numberOrHash: '99' }
    );
    expect(missing.status).toBe(404);

    const first = await list(internalGet, '/api/v2/internal-transactions?limit=4');
    expect(first.body.items.map((item: { block_number: number }) => item.block_number)).toEqual([
      8, 7, 6, 6,
    ]);
    expect(first.body.next_page_params).toMatchObject({
      page: 2,
      limit: 4,
      block_number: 6,
      index: 1,
    });
    const query = new URLSearchParams(
      Object.entries(first.body.next_page_params).map(([key, value]) => [key, String(value)])
    ).toString();
    const second = await list(internalGet, `/api/v2/internal-transactions?${query}`);
    expect(second.body.items.map((item: { block_number: number }) => item.block_number)).toEqual([
      5, 5,
    ]);
    expect(second.body.next_page_params).toBeNull();
  });
});

describe('v2 transactions', () => {
  it('reports errors inside a transaction only where the indexer has been', async () => {
    const { body } = await list(txListGet, '/api/v2/transactions');
    const flags = Object.fromEntries(
      body.items.map(
        (item: { hash: string; has_error_in_internal_transactions: boolean | null }) => [
          item.hash,
          item.has_error_in_internal_transactions,
        ]
      )
    );
    expect(flags).toEqual({
      [TX_OK]: false,
      [TX_FAILED]: true,
      [TX_CREATE]: false,
      [TX_OTHER]: false,
      [TX_LATE]: null,
    });
  });

  it('returns one transaction with its token transfers and the internal error flag', async () => {
    const { status, body } = await call(
      txGet as Handler<{ hash: string }>,
      `/api/v2/transactions/${TX_OK}`,
      {
        hash: TX_OK,
      }
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      hash: TX_OK,
      block_number: 5,
      status: 'ok',
      has_error_in_internal_transactions: false,
      token_transfers_overflow: false,
    });
    expect(body.token_transfers).toHaveLength(2);
    const multi = body.token_transfers.find(
      (transfer: { token: { address_hash: string } }) => transfer.token.address_hash === MULTI
    );
    expect(multi).toMatchObject({
      token_type: 'ERC-1155',
      total: { decimals: null, token_id: BIG_ID, value: '5', token_instance: null },
      log_index: 3,
    });
    const unknown = await call(
      txGet as Handler<{ hash: string }>,
      `/api/v2/transactions/${pad('9', 64)}`,
      {
        hash: pad('9', 64),
      }
    );
    expect(unknown.status).toBe(404);
  });
});

describe('v2 VRC-1155 holdings and transfers', () => {
  it('lists a VRC-1155 holding per token id', async () => {
    const { body } = await call(
      balancesGet as Handler<{ address: string }>,
      `/api/v2/addresses/${ALICE}/token-balances`,
      { address: ALICE }
    );
    const rows = body.map(
      (row: { token: { address_hash: string }; token_id: string | null; value: string }) => [
        row.token.address_hash,
        row.token_id,
        row.value,
      ]
    );
    // ALICE received 7 of id 2 and passed them on: only the big id is left
    expect(rows).toEqual([
      [MULTI, BIG_ID, '5'],
      [NFT, null, '1'],
    ]);
  });

  it('filters the token transfers of an address by standard', async () => {
    const path = `/api/v2/addresses/${ALICE}/token-transfers`;
    const multi = await call(
      addressTransfersGet as Handler<{ address: string }>,
      `${path}?type=ERC-1155`,
      {
        address: ALICE,
      }
    );
    expect(multi.body.items).toHaveLength(3);
    expect(
      multi.body.items.every((item: { token_type: string }) => item.token_type === 'ERC-1155')
    ).toBe(true);
    const nft = await call(
      addressTransfersGet as Handler<{ address: string }>,
      `${path}?type=ERC-721`,
      {
        address: ALICE,
      }
    );
    expect(
      nft.body.items.map((item: { token: { address_hash: string } }) => item.token.address_hash)
    ).toEqual([NFT]);
    const both = await call(
      addressTransfersGet as Handler<{ address: string }>,
      `${path}?type=ERC-721,ERC-1155`,
      { address: ALICE }
    );
    expect(both.body.items).toHaveLength(4);
  });
});
