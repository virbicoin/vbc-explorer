/**
 * The event log indexer (lib/sync/logs.ts, tools/logs.ts) and the Blockscout v2 lists added
 * with it: logs of an address and the logs tab count, the chain's token transfers, NFT
 * instances, and the coin balance history. mongodb-memory-server; the node is a spy.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Block, Log, ScanProgress, Token, TokenTransfer, Transaction } from '@/models/index';
import { getClient } from '@/lib/web3/provider';
import { indexLogs, type RawReceipt, type ReceiptSource } from '@/lib/sync/logs';
import { rewindRangeScans } from '@/lib/sync/range-scan';
import { indexLogsToConfirmedHead } from '@/tools/logs';
import { GET as addressLogsGet } from '@/app/api/v2/addresses/[address]/logs/route';
import { GET as tabsGet } from '@/app/api/v2/addresses/[address]/tabs-counters/route';
import { GET as transfersGet } from '@/app/api/v2/token-transfers/route';
import { GET as instancesGet } from '@/app/api/v2/tokens/[address]/instances/route';
import { GET as instanceGet } from '@/app/api/v2/tokens/[address]/instances/[id]/route';
import { GET as balanceHistoryGet } from '@/app/api/v2/addresses/[address]/coin-balance-history/route';
import { GET as balanceByDayGet } from '@/app/api/v2/addresses/[address]/coin-balance-history-by-day/route';

vi.mock('@/lib/services/nft-metadata.service', async (original) => ({
  ...(await original<typeof import('@/lib/services/nft-metadata.service')>()),
  fetchNftMetadata: vi.fn(async (_address: string, tokenId: number) => ({
    metadata: {
      name: `Cat #${tokenId}`,
      description: null,
      image: `https://img.example/${tokenId}.png`,
      attributes: [],
    },
    tokenURI: `https://meta.example/${tokenId}`,
  })),
}));

let mongod: MongoMemoryServer;
let ipCounter = 0;

const pad = (prefix: string, length: number) => `0x${prefix.padEnd(length, '0')}`;
const ALICE = pad('a11ce', 40);
const BOB = pad('b0b', 40);
const CONTRACT = pad('c0de', 40);
const OTHER = pad('07e4', 40);
const NFT = pad('f721', 40);
const MULTI = pad('e1155', 40);
const COIN = pad('c014', 40);
const SPAM = pad('5ba3', 40);
const ZERO = pad('', 40);
const TOPIC = pad('ddf252ad', 64);
const OTHER_TOPIC = pad('8c5be1e5', 64);
const GENESIS_TIME = 1_760_000_000;
const time = (block: number) => GENESIS_TIME + block * 10;
const txHash = (n: number) => pad(`7${n}`, 64);
const blockHash = (n: number) => pad(`b${n}`, 64);

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

/** A receipt for transaction n with the given logs (address, topics). */
const receipt = (
  n: number,
  block: number,
  logs: Array<[string, string[]]>,
  hashOfBlock = blockHash(block)
): RawReceipt => ({
  transactionHash: txHash(n),
  transactionIndex: '0x0',
  blockHash: hashOfBlock,
  blockNumber: `0x${block.toString(16)}`,
  logs: logs.map(([address, topics], index) => ({
    address: address.toUpperCase().replace('0X', '0x'),
    topics,
    data: `0x0${index}`,
    logIndex: `0x${index.toString(16)}`,
  })),
});
const source = (receipts: Map<string, RawReceipt | null>): ReceiptSource => ({
  receipt: async (hash) => receipts.get(hash) ?? null,
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('explorerDB_logs');
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
    Array.from({ length: 30 }, (_, number) => ({
      number,
      hash: blockHash(number),
      timestamp: time(number),
      miner: number === 12 ? ALICE : OTHER,
    }))
  );
  // transactions in blocks 2, 4, 6 (two) and 20
  await Transaction.collection.insertMany(
    [
      [1, 2, ALICE, CONTRACT],
      [2, 4, BOB, CONTRACT],
      [3, 6, ALICE, OTHER],
      [4, 6, BOB, CONTRACT],
      [5, 20, ALICE, CONTRACT],
    ].map(([n, block, from, to], index) => ({
      hash: txHash(n as number),
      blockNumber: block,
      blockHash: blockHash(block as number),
      transactionIndex: index,
      from,
      to,
      value: '0',
      timestamp: time(block as number),
    }))
  );
});

afterEach(() => vi.restoreAllMocks());

describe('log indexer', () => {
  it('stores the logs of a range from receipts, with the stored block and time', async () => {
    const receipts = new Map<string, RawReceipt | null>([
      [txHash(1), receipt(1, 2, [[CONTRACT, [TOPIC, pad('a11ce', 64)]]])],
      [txHash(2), receipt(2, 4, [])],
      [txHash(3), receipt(3, 6, [[OTHER, [OTHER_TOPIC]]])],
      [
        txHash(4),
        receipt(4, 6, [
          [CONTRACT, [TOPIC]],
          [CONTRACT, [OTHER_TOPIC]],
        ]),
      ],
    ]);
    const result = await indexLogs(source(receipts), 0, 10);
    expect(result).toMatchObject({
      from: 0,
      committedTo: 10,
      transactions: 4,
      logs: 4,
      failure: null,
    });
    const logs = await Log.find().sort({ blockNumber: 1, logIndex: 1 }).lean();
    expect(logs.map((log) => [log.address, log.blockNumber, log.logIndex, log.topics])).toEqual([
      [CONTRACT, 2, 0, [TOPIC, pad('a11ce', 64)]],
      [OTHER, 6, 0, [OTHER_TOPIC]],
      [CONTRACT, 6, 0, [TOPIC]],
      [CONTRACT, 6, 1, [OTHER_TOPIC]],
    ]);
    expect(logs[0]).toMatchObject({
      blockHash: blockHash(2),
      transactionHash: txHash(1),
      timestamp: time(2),
      data: '0x00',
    });
  });

  it('writes only the blocks below a receipt from another block, and rewrites a range whole', async () => {
    await Log.collection.insertOne({
      address: CONTRACT,
      blockNumber: 6,
      logIndex: 9,
      transactionHash: pad('dead', 64),
      topics: [],
    });
    const receipts = new Map<string, RawReceipt | null>([
      [txHash(1), receipt(1, 2, [[CONTRACT, [TOPIC]]])],
      [txHash(2), receipt(2, 4, [[CONTRACT, [TOPIC]]])],
      [txHash(3), receipt(3, 6, [[OTHER, [TOPIC]]], pad('0f', 64))],
      [txHash(4), receipt(4, 6, [[CONTRACT, [TOPIC]]])],
    ]);
    const result = await indexLogs(source(receipts), 0, 10);
    expect(result.committedTo).toBe(5);
    expect(result.failure).toMatchObject({ blockNumber: 6, transactionHash: txHash(3) });
    expect((await Log.find().lean()).map((log) => log.blockNumber).sort()).toEqual([2, 4, 6]);

    // a later run with good receipts replaces block 6 whole (the stray log goes)
    receipts.set(txHash(3), receipt(3, 6, [[OTHER, [TOPIC]]]));
    await indexLogs(source(receipts), 6, 10);
    const block6 = await Log.find({ blockNumber: 6 }).lean();
    expect(block6.map((log) => log.transactionHash).sort()).toEqual([txHash(3), txHash(4)].sort());
  });

  it('follows the confirmed head, skips a transaction after three failures, and is rewound by a reorg', async () => {
    const receipts = new Map<string, RawReceipt | null>([
      [txHash(1), receipt(1, 2, [[CONTRACT, [TOPIC]]])],
      [txHash(2), null],
      [txHash(3), receipt(3, 6, [])],
      [txHash(4), receipt(4, 6, [])],
      [txHash(5), receipt(5, 20, [[CONTRACT, [TOPIC]]])],
    ]);
    const attempts = new Map<string, number>();
    for (let run = 0; run < 3; run++) {
      await indexLogsToConfirmedHead(source(receipts), { confirmations: 12, attempts });
    }
    const marker = (await ScanProgress.findOne({ scanType: 'logs' }).lean()) as Record<
      string,
      unknown
    >;
    // stored head 29, 12 confirmations: blocks up to 16; tx 2 given up on after three tries
    expect(marker.lastScannedBlock).toBe(16);
    expect(
      (marker.skipped as Array<{ transactionHash: string }>).map((s) => s.transactionHash)
    ).toEqual([txHash(2)]);
    expect(await Log.countDocuments({ blockNumber: 20 })).toBe(0);

    expect(await rewindRangeScans(6)).toBeGreaterThan(0);
    const rewound = (await ScanProgress.findOne({ scanType: 'logs' }).lean()) as Record<
      string,
      unknown
    >;
    expect(rewound.lastScannedBlock).toBe(5);
  });
});

describe('logs of an address', () => {
  beforeEach(async () => {
    await Log.collection.insertMany(
      Array.from({ length: 60 }, (_, i) => ({
        address: CONTRACT,
        blockNumber: 100 + i,
        blockHash: blockHash(100 + i),
        transactionHash: pad(`1${i}`, 64),
        transactionIndex: 0,
        logIndex: 0,
        topics: [i % 2 === 0 ? TOPIC : OTHER_TOPIC, pad('a11ce', 64)],
        data: '0x',
        timestamp: time(100 + i),
      }))
    );
  });

  it('lists them newest first in pages, filters by topic, and counts them on the tabs', async () => {
    const first = await call(addressLogsGet, `/api/v2/addresses/${CONTRACT}/logs`, {
      address: CONTRACT,
    });
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(50);
    expect(first.body.items[0]).toMatchObject({
      address: expect.objectContaining({ hash: CONTRACT }),
      block_number: 159,
      index: 0,
      topics: [OTHER_TOPIC, pad('a11ce', 64), null, null],
      decoded: null,
    });
    expect(first.body.next_page_params).toMatchObject({ page: 2, block_number: 110 });
    const second = await call(addressLogsGet, `/api/v2/addresses/${CONTRACT}/logs?page=2`, {
      address: CONTRACT,
    });
    expect(second.body.items).toHaveLength(10);
    expect(second.body.next_page_params).toBeNull();

    const topic = await call(addressLogsGet, `/api/v2/addresses/${CONTRACT}/logs?topic=${TOPIC}`, {
      address: CONTRACT,
    });
    expect(topic.body.items.every((item: { topics: string[] }) => item.topics[0] === TOPIC)).toBe(
      true
    );
    expect(topic.body.items).toHaveLength(30);
    const bad = await call(addressLogsGet, `/api/v2/addresses/${CONTRACT}/logs?topic=0x12`, {
      address: CONTRACT,
    });
    expect(bad.status).toBe(400);

    const tabs = await call(tabsGet, `/api/v2/addresses/${CONTRACT}/tabs-counters`, {
      address: CONTRACT,
    });
    expect(tabs.body.logs_count).toBe(51);
    const none = await call(tabsGet, `/api/v2/addresses/${BOB}/tabs-counters`, { address: BOB });
    expect(none.body.logs_count).toBe(0);
  });
});

describe('token transfers of the chain and NFT instances', () => {
  beforeEach(async () => {
    await Token.collection.insertMany([
      { address: NFT, name: 'Cats', symbol: 'CAT', type: 'VRC-721', decimals: 0 },
      { address: MULTI, name: 'Items', symbol: 'ITM', type: 'VRC-1155', decimals: 0 },
      { address: COIN, name: 'Coin', symbol: 'CN', type: 'VRC-20', decimals: 18 },
      { address: SPAM, name: 'Spam', symbol: 'SPM', type: 'VRC-20', decimals: 18, hidden: true },
    ]);
    const at = (block: number) => new Date(time(block) * 1000);
    await TokenTransfer.collection.insertMany([
      {
        tokenAddress: NFT,
        tokenId: 1,
        from: ZERO,
        to: ALICE,
        blockNumber: 1,
        timestamp: at(1),
        transactionHash: txHash(1),
      },
      {
        tokenAddress: NFT,
        tokenId: 2,
        from: ZERO,
        to: ALICE,
        blockNumber: 2,
        timestamp: at(2),
        transactionHash: txHash(2),
      },
      {
        tokenAddress: NFT,
        tokenId: 1,
        from: ALICE,
        to: BOB,
        blockNumber: 5,
        timestamp: at(5),
        transactionHash: txHash(3),
      },
      {
        tokenAddress: NFT,
        tokenId: 3,
        from: ZERO,
        to: BOB,
        blockNumber: 6,
        timestamp: at(6),
        transactionHash: txHash(4),
      },
      {
        tokenAddress: NFT,
        tokenId: 3,
        from: BOB,
        to: ZERO,
        blockNumber: 7,
        timestamp: at(7),
        transactionHash: txHash(5),
      },
      {
        tokenAddress: MULTI,
        tokenId: '7',
        tokenType: 'VRC-1155',
        from: ZERO,
        to: ALICE,
        value: '5',
        logIndex: 0,
        blockNumber: 8,
        timestamp: at(8),
        transactionHash: txHash(6),
      },
      {
        tokenAddress: COIN,
        from: ALICE,
        to: BOB,
        value: '10',
        logIndex: 0,
        blockNumber: 9,
        timestamp: at(9),
        transactionHash: txHash(7),
      },
      {
        tokenAddress: SPAM,
        from: ALICE,
        to: BOB,
        value: '10',
        logIndex: 1,
        blockNumber: 10,
        timestamp: at(10),
        transactionHash: txHash(8),
      },
    ]);
  });

  it('lists the chain’s transfers newest first, by type, without hidden tokens', async () => {
    const all = await call(
      transfersGet as Handler<never>,
      '/api/v2/token-transfers',
      undefined as never
    );
    expect(all.status).toBe(200);
    expect(all.body.items.map((item: { block_number: number }) => item.block_number)).toEqual([
      9, 8, 7, 6, 5, 2, 1,
    ]);
    expect(all.body.items[0]).toMatchObject({
      token: expect.objectContaining({ address_hash: COIN }),
      token_type: 'ERC-20',
    });
    const nfts = await call(
      transfersGet as Handler<never>,
      '/api/v2/token-transfers?type=ERC-721',
      undefined as never
    );
    expect(nfts.body.items).toHaveLength(5);
    const several = await call(
      transfersGet as Handler<never>,
      '/api/v2/token-transfers?type=ERC-20,ERC-1155',
      undefined as never
    );
    expect(several.body.items.map((item: { token_type: string }) => item.token_type)).toEqual([
      'ERC-20',
      'ERC-1155',
    ]);
    const bad = await call(
      transfersGet as Handler<never>,
      '/api/v2/token-transfers?type=ERC-404',
      undefined as never
    );
    expect(bad.status).toBe(400);
  });

  it('lists NFT instances with their owners, highest id first, without burned ids', async () => {
    const cats = await call(instancesGet, `/api/v2/tokens/${NFT}/instances`, { address: NFT });
    expect(
      cats.body.items.map((item: { id: string; owner: { hash: string } | null }) => [
        item.id,
        item.owner?.hash,
      ])
    ).toEqual([
      ['2', ALICE],
      ['1', BOB],
    ]);
    expect(cats.body.items[0]).toMatchObject({
      is_unique: true,
      token_type: 'ERC-721',
      metadata: null,
    });
    const items = await call(instancesGet, `/api/v2/tokens/${MULTI}/instances`, { address: MULTI });
    expect(items.body.items).toEqual([
      expect.objectContaining({ id: '7', owner: null, is_unique: false, token_type: 'ERC-1155' }),
    ]);
    const coin = await call(instancesGet, `/api/v2/tokens/${COIN}/instances`, { address: COIN });
    expect(coin.body.items).toEqual([]);
    const unknown = await call(instancesGet, `/api/v2/tokens/${OTHER}/instances`, {
      address: OTHER,
    });
    expect(unknown.status).toBe(404);
  });

  it('shows one instance with its owner and metadata', async () => {
    const cat = await call(instanceGet, `/api/v2/tokens/${NFT}/instances/1`, {
      address: NFT,
      id: '1',
    });
    expect(cat.status).toBe(200);
    expect(cat.body).toMatchObject({
      id: '1',
      owner: expect.objectContaining({ hash: BOB }),
      metadata: expect.objectContaining({ name: 'Cat #1' }),
      image_url: 'https://img.example/1.png',
      is_unique: true,
    });
    const burned = await call(instanceGet, `/api/v2/tokens/${NFT}/instances/3`, {
      address: NFT,
      id: '3',
    });
    expect(burned.body.owner).toBeNull();
    const missing = await call(instanceGet, `/api/v2/tokens/${NFT}/instances/99`, {
      address: NFT,
      id: '99',
    });
    expect(missing.status).toBe(404);
    const bad = await call(instanceGet, `/api/v2/tokens/${NFT}/instances/x1`, {
      address: NFT,
      id: 'x1',
    });
    expect(bad.status).toBe(400);
    const multi = await call(instanceGet, `/api/v2/tokens/${MULTI}/instances/7`, {
      address: MULTI,
      id: '7',
    });
    expect(multi.body).toMatchObject({ id: '7', owner: null, is_unique: false });
  });
});

describe('coin balance history', () => {
  /** eth_getBalance answers from this table (block → wei). */
  function mockBalances(table: Record<number, bigint>) {
    const asked: number[] = [];
    vi.spyOn(getClient(), 'request').mockImplementation((async (args: {
      method: string;
      params: unknown[];
    }) => {
      if (args.method !== 'eth_getBalance') throw new Error(`unexpected ${args.method}`);
      const block = Number(BigInt(args.params[1] as string));
      asked.push(block);
      const known = Object.keys(table)
        .map(Number)
        .filter((height) => height <= block);
      const value = known.length ? table[Math.max(...known)] : 0n;
      return `0x${value.toString(16)}`;
    }) as never);
    return asked;
  }

  it('lists the balance at each change, newest first, with the change from the older entry', async () => {
    // ALICE: transactions in blocks 2, 6, 20 and the block she mined, 12
    mockBalances({ 1: 0n, 2: 100n, 6: 70n, 12: 78n, 20: 50n });
    const history = await call(
      balanceHistoryGet,
      `/api/v2/addresses/${ALICE}/coin-balance-history`,
      { address: ALICE }
    );
    expect(history.status).toBe(200);
    expect(history.body.items).toEqual([
      {
        block_number: 20,
        block_timestamp: new Date(time(20) * 1000).toISOString(),
        delta: '-28',
        transaction_hash: txHash(5),
        value: '50',
      },
      {
        block_number: 12,
        block_timestamp: new Date(time(12) * 1000).toISOString(),
        delta: '8',
        transaction_hash: null,
        value: '78',
      },
      {
        block_number: 6,
        block_timestamp: new Date(time(6) * 1000).toISOString(),
        delta: '-30',
        transaction_hash: txHash(3),
        value: '70',
      },
      {
        block_number: 2,
        block_timestamp: new Date(time(2) * 1000).toISOString(),
        delta: '100',
        transaction_hash: txHash(1),
        value: '100',
      },
    ]);
    expect(history.body.next_page_params).toBeNull();

    const paged = await call(
      balanceHistoryGet,
      `/api/v2/addresses/${ALICE}/coin-balance-history?limit=2`,
      { address: ALICE }
    );
    expect(
      paged.body.items.map((item: { block_number: number; delta: string }) => [
        item.block_number,
        item.delta,
      ])
    ).toEqual([
      [20, '-28'],
      [12, '8'],
    ]);
    expect(paged.body.next_page_params).toMatchObject({ page: 2, block_number: 12 });
  });

  it('gives the balance at the end of each day, oldest first', async () => {
    mockBalances({ 0: 5n });
    const now = Math.floor(Date.now() / 1000);
    await Block.collection.insertOne({ number: 1000, hash: blockHash(1000), timestamp: now });
    const byDay = await call(
      balanceByDayGet,
      `/api/v2/addresses/${BOB}/coin-balance-history-by-day?days=3`,
      { address: BOB }
    );
    expect(byDay.status).toBe(200);
    expect(byDay.body.days).toBe(3);
    expect(byDay.body.items).toHaveLength(3);
    expect(byDay.body.items.at(-1)).toEqual({
      date: new Date(now * 1000).toISOString().slice(0, 10),
      value: '5',
    });
  });
});
