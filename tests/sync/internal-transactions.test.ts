/**
 * Internal transactions from call traces: the conversion of real Ovbc
 * `trace_transaction` answers (tests/fixtures/ovbc-traces.json), the range
 * indexer, the progress marker shared with replaceBlock(), and the indexer
 * loop of tools/internal-txs.ts. mongodb-memory-server.
 */
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Block, InternalTransaction, ScanProgress, Transaction } from '@/models/index';
import {
  indexInternalTransactions,
  internalTransactionsFromTraces,
  quantity,
  type ParityTrace,
  type TraceSource,
  parityTracesFromGethCallTrace,
  createTraceSource,
  isMethodMissing,
  type GethCallFrame,
} from '@/lib/sync/internal-transactions';
import {
  claimRange,
  completeRange,
  loadRangeScan,
  loadSkipped,
  recordSkipped,
  resetRangeScan,
  rewindRangeScans,
} from '@/lib/sync/range-scan';
import { indexToConfirmedHead } from '../../tools/internal-txs';

interface Fixture {
  transaction: {
    hash: string;
    blockNumber: number;
    blockHash: string;
    transactionIndex: number;
    timestamp: number;
    status: number;
  };
  traces: ParityTrace[];
}

const fixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'ovbc-traces.json'), 'utf8')
) as Record<string, Fixture>;
const NAMES = ['rootCreate', 'failedWithInternalCreate', 'internalCreate', 'swap', 'selfdestruct'];
const { swap, failedWithInternalCreate, rootCreate, selfdestruct, internalCreate } = fixtures;

const context = (fixture: Fixture) => ({
  transactionHash: fixture.transaction.hash,
  blockNumber: fixture.transaction.blockNumber,
  blockHash: fixture.transaction.blockHash,
  transactionIndex: fixture.transaction.transactionIndex,
  timestamp: fixture.transaction.timestamp,
});
const convert = (fixture: Fixture) =>
  internalTransactionsFromTraces(fixture.traces, context(fixture));
const dec = (hex: string) => BigInt(hex).toString();

const ROUTER = '0x9ad9b2b3e9c6ffd90d05bc322e01acb2876abaa9';
const WVBC = '0x52cb9f0d65d9d4de08cf103153c7a1a97567bb9b';
const SENDER = '0x47c93fd5a9fdf1516ffeabb74d0b5a44786d7026';
const PLAIN_TX = `0x${'ab'.repeat(32)}`;

/** A trace source answering from the fixtures (and [] for anything else). */
class FakeTraceSource implements TraceSource {
  traces = new Map<string, ParityTrace[]>();
  calls = 0;
  failWith: Error | null = null;
  constructor() {
    for (const name of NAMES)
      this.traces.set(fixtures[name].transaction.hash, fixtures[name].traces);
    this.traces.set(PLAIN_TX, [
      {
        type: 'call',
        action: { callType: 'call', from: SENDER, to: ROUTER, value: '0x1', gas: '0x0' },
        result: { gasUsed: '0x0', output: '0x' },
        traceAddress: [],
        transactionHash: PLAIN_TX,
        blockHash: `0x${'cd'.repeat(32)}`,
      },
    ]);
  }
  async traceTransaction(hash: string) {
    this.calls++;
    if (this.failWith) throw this.failWith;
    return this.traces.get(hash) ?? [];
  }
  close() {}
}

async function seedTransactions() {
  await Transaction.collection.insertMany([
    ...NAMES.map((name) => ({ ...fixtures[name].transaction })),
    {
      hash: PLAIN_TX,
      blockNumber: 1_300_000,
      blockHash: `0x${'cd'.repeat(32)}`,
      transactionIndex: 0,
      timestamp: 1_766_000_000,
      status: 1,
    },
  ]);
}

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('explorerDB_internal'), { autoIndex: false });
  await InternalTransaction.createIndexes();
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    InternalTransaction.deleteMany({}),
    Transaction.deleteMany({}),
    Block.deleteMany({}),
    ScanProgress.deleteMany({}),
  ]);
});

describe('internalTransactionsFromTraces', () => {
  it('keeps every frame of a swap except the transaction itself, in trace order', () => {
    const docs = convert(swap);
    expect(docs.map((doc) => doc.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(docs[0]).toEqual({
      transactionHash: swap.transaction.hash,
      index: 1,
      traceAddress: [0],
      blockNumber: 1213899,
      blockHash: swap.transaction.blockHash,
      transactionIndex: 1,
      timestamp: 1765663458,
      type: 'call',
      callType: 'staticcall',
      from: ROUTER,
      to: '0xe85a5bf52711c1ed2e94c8d6c8ba6717e70fe94f',
      value: '0',
      gas: dec('0x193ec'),
      gasUsed: dec('0x377'),
      error: null,
      reverted: false,
    });
    // WVBC pays the router, the router pays the sender
    expect(docs[10]).toMatchObject({
      index: 11,
      traceAddress: [6, 0],
      callType: 'call',
      from: WVBC,
      to: ROUTER,
      value: dec('0x70585937378a62a'),
    });
    expect(docs[11]).toMatchObject({ index: 12, from: ROUTER, to: SENDER, gasUsed: '0' });
  });

  it('marks everything under a failed call as reverted and keeps each frame its own error', () => {
    const docs = convert(failedWithInternalCreate);
    expect(docs.map((doc) => [doc.index, doc.type, doc.error, doc.reverted])).toEqual([
      [1, 'call', null, true],
      [2, 'call', 'Reverted', true],
      [3, 'create', 'Bad instruction', true],
    ]);
    // a failed creation made no contract
    expect(docs[2].createdContract).toBeUndefined();
    expect(docs[2]).toMatchObject({ to: null, gasUsed: null, callType: null });
  });

  it('keeps a top-level creation with the created contract', () => {
    expect(convert(rootCreate)).toEqual([
      expect.objectContaining({
        index: 0,
        traceAddress: [],
        type: 'create',
        callType: null,
        from: SENDER,
        to: null,
        createdContract: '0xd26488ea362005b023bc9f55157370c63c94d0c7',
        gasUsed: dec('0x1ef523'),
        reverted: false,
      }),
    ]);
  });

  it('stores a contract created by a contract', () => {
    const docs = convert(internalCreate);
    expect(docs.map((doc) => [doc.index, doc.type, doc.createdContract])).toEqual([
      [1, 'create', '0x79f9217c39687ffa4808032a446c3db76970ca65'],
      [2, 'call', undefined],
    ]);
  });

  it('reads a selfdestruct as a transfer from the contract to the beneficiary', () => {
    expect(convert(selfdestruct)).toEqual([
      expect.objectContaining({
        index: 1,
        type: 'selfdestruct',
        from: '0xccb5ef9431f5bc51f0a5b743e8994f6244b42522',
        to: SENDER,
        value: '0',
        gas: '0',
        gasUsed: null,
      }),
    ]);
  });

  it('ignores reward frames and recognises create2 and delegatecall', () => {
    const docs = internalTransactionsFromTraces(
      [
        { type: 'call', action: { callType: 'call', from: SENDER, to: ROUTER }, traceAddress: [] },
        {
          type: 'call',
          action: { callType: 'delegatecall', from: ROUTER, to: WVBC, value: '0x0' },
          traceAddress: [0],
        },
        {
          type: 'create',
          action: { from: ROUTER, value: '0x5', gas: '0x10', creationMethod: 'create2' },
          result: { address: '0xABCDEF0000000000000000000000000000000001', gasUsed: '0x1' },
          traceAddress: [1],
        },
        { type: 'reward', action: { value: '0x1' } },
      ],
      context(swap)
    );
    expect(docs.map((doc) => [doc.index, doc.type, doc.callType, doc.createdContract])).toEqual([
      [1, 'call', 'delegatecall', undefined],
      [2, 'create2', null, '0xabcdef0000000000000000000000000000000001'],
    ]);
    expect(docs[1].value).toBe('5');
  });

  it('reads quantities', () => {
    expect(quantity('0x')).toBe('0');
    expect(quantity(undefined)).toBe('0');
    expect(quantity('0xff')).toBe('255');
    expect(quantity(7)).toBe('7');
  });
});

describe('indexInternalTransactions', () => {
  const ALL = 12 + 3 + 1 + 1 + 2;

  it('stores the frames of every transaction of the range and reports created contracts', async () => {
    await seedTransactions();
    const source = new FakeTraceSource();
    const result = await indexInternalTransactions(source, 0, 2_000_000);
    expect(result).toMatchObject({
      from: 0,
      committedTo: 2_000_000,
      transactions: 6,
      internalTransactions: ALL,
      failure: null,
    });
    expect(result.createdContracts.map((created) => created.address).sort()).toEqual([
      '0x79f9217c39687ffa4808032a446c3db76970ca65',
      '0xd26488ea362005b023bc9f55157370c63c94d0c7',
    ]);
    expect(await InternalTransaction.countDocuments({})).toBe(ALL);
    const stored = (await InternalTransaction.find({ transactionHash: swap.transaction.hash })
      .sort({ index: 1 })
      .lean()) as Array<{ index: number; from: string }>;
    expect(stored.map((doc) => doc.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('is idempotent and rewrites the range as a whole', async () => {
    await seedTransactions();
    const source = new FakeTraceSource();
    await indexInternalTransactions(source, 0, 2_000_000);
    // left over from a transaction that is no longer stored in the range
    await InternalTransaction.collection.insertOne({
      transactionHash: '0xgone',
      index: 1,
      blockNumber: 1_300_001,
    });
    // the swap moved out of the range (re-included elsewhere)
    await Transaction.collection.updateOne(
      { hash: swap.transaction.hash },
      { $set: { blockNumber: 3_000_000 } }
    );
    const again = await indexInternalTransactions(source, 0, 2_000_000);
    expect(again.internalTransactions).toBe(ALL - 12);
    expect(await InternalTransaction.countDocuments({})).toBe(ALL - 12);
    expect(await InternalTransaction.countDocuments({ transactionHash: '0xgone' })).toBe(0);
  });

  it('writes nothing from the first block whose stored hash differs from the traced one', async () => {
    await seedTransactions();
    await Transaction.collection.updateOne(
      { hash: swap.transaction.hash },
      { $set: { blockHash: `0x${'ee'.repeat(32)}` } }
    );
    const result = await indexInternalTransactions(new FakeTraceSource(), 0, 2_000_000);
    expect(result.failure).toMatchObject({
      blockNumber: 1213899,
      transactionHash: swap.transaction.hash,
    });
    expect(result.failure?.reason).toContain('traced in block');
    expect(result.committedTo).toBe(1213898);
    // root create, failed call, internal create: written; swap and selfdestruct: not
    expect(await InternalTransaction.countDocuments({})).toBe(1 + 3 + 2);
    expect(await InternalTransaction.countDocuments({ blockNumber: { $gte: 1213899 } })).toBe(0);
  });

  it('stops at a transaction the node does not know, unless it is to be skipped', async () => {
    await seedTransactions();
    const source = new FakeTraceSource();
    source.traces.delete(selfdestruct.transaction.hash);
    const stopped = await indexInternalTransactions(source, 0, 2_000_000);
    expect(stopped.failure?.reason).toContain('no trace');
    expect(stopped.committedTo).toBe(1364087);

    const skipped = await indexInternalTransactions(source, 0, 2_000_000, {
      skip: new Set([selfdestruct.transaction.hash]),
    });
    expect(skipped.failure).toBeNull();
    expect(skipped.committedTo).toBe(2_000_000);
    expect(await InternalTransaction.countDocuments({})).toBe(ALL - 1);
  });

  it('cuts a range after whole blocks at maxTransactions', async () => {
    await seedTransactions();
    const result = await indexInternalTransactions(new FakeTraceSource(), 0, 2_000_000, {
      maxTransactions: 2,
    });
    // blocks 235 and 1213749; the range ends before 1213893
    expect(result.committedTo).toBe(1213892);
    expect(result.transactions).toBe(2);
  });

  it('throws on a connection error and writes nothing', async () => {
    await seedTransactions();
    const source = new FakeTraceSource();
    source.failWith = new Error('connect ENOENT');
    await expect(indexInternalTransactions(source, 0, 2_000_000)).rejects.toThrow('ENOENT');
    expect(await InternalTransaction.countDocuments({})).toBe(0);
  });
});

describe('range scan marker', () => {
  const SCAN = 'internal-transactions' as const;

  it('starts at -1 and moves forward through claim and complete', async () => {
    const state = await loadRangeScan(SCAN);
    expect(state).toEqual({ lastScannedBlock: -1, generation: null });
    expect(await claimRange(SCAN, state, 100)).toBe(true);
    expect(await completeRange(SCAN, state, 100)).toBe(true);
    const marker = (await ScanProgress.findOne({ scanType: SCAN }).lean()) as Record<
      string,
      unknown
    >;
    expect(marker).toMatchObject({ lastScannedBlock: 100, inFlightTo: null });
  });

  it('does not record a range that a rewrite touched while it was being indexed', async () => {
    await resetRangeScan(SCAN, 41); // marker 40
    const state = await loadRangeScan(SCAN);
    await claimRange(SCAN, state, 100);
    expect(await rewindRangeScans(60)).toBe(1);
    expect(await completeRange(SCAN, state, 100)).toBe(false);
    const after = await loadRangeScan(SCAN);
    expect(after.lastScannedBlock).toBe(40);
    expect(after.generation).toBe((state.generation ?? 0) + 1);
  });

  it('rewinds a marker past the rewritten height and ignores heights above the range', async () => {
    await resetRangeScan(SCAN, 501); // marker 500
    expect(await rewindRangeScans(900)).toBe(0);
    expect((await loadRangeScan(SCAN)).lastScannedBlock).toBe(500);
    expect(await rewindRangeScans(300)).toBe(1);
    expect((await loadRangeScan(SCAN)).lastScannedBlock).toBe(299);
  });

  it('remembers skipped transactions', async () => {
    await loadRangeScan(SCAN);
    await recordSkipped(SCAN, { blockNumber: 5, transactionHash: '0xaa', reason: 'test' });
    expect([...(await loadSkipped(SCAN))]).toEqual(['0xaa']);
  });
});

describe('indexToConfirmedHead (tools/internal-txs.ts)', () => {
  const HEAD = 1_364_200;
  const CONFIRMATIONS = 12;

  beforeEach(async () => {
    await seedTransactions();
    await Block.collection.insertOne({ number: HEAD, hash: '0xhead' });
  });

  it('indexes up to the confirmed head and registers created contracts', async () => {
    const created: string[] = [];
    const result = await indexToConfirmedHead(new FakeTraceSource(), {
      confirmations: CONFIRMATIONS,
      onContractCreated: async (contract) => {
        created.push(contract.address);
      },
    });
    expect(result.lastScannedBlock).toBe(HEAD - CONFIRMATIONS - 1);
    expect(result.internalTransactions).toBe(19);
    expect(result.pending).toBeNull();
    expect(created.sort()).toEqual([
      '0x79f9217c39687ffa4808032a446c3db76970ca65',
      '0xd26488ea362005b023bc9f55157370c63c94d0c7',
    ]);
    // nothing left to do
    const again = await indexToConfirmedHead(new FakeTraceSource(), {
      confirmations: CONFIRMATIONS,
    });
    expect(again.ranges).toBe(0);
  });

  it('retries a transaction it cannot trace and skips it after three runs', async () => {
    const source = new FakeTraceSource();
    source.traces.delete(swap.transaction.hash);
    const attempts = new Map<string, number>();
    const options = { confirmations: CONFIRMATIONS, attempts };

    const first = await indexToConfirmedHead(source, options);
    expect(first.pending?.transactionHash).toBe(swap.transaction.hash);
    expect(first.lastScannedBlock).toBe(1213898);
    const second = await indexToConfirmedHead(source, options);
    expect(second.pending?.transactionHash).toBe(swap.transaction.hash);

    const third = await indexToConfirmedHead(source, options);
    expect(third.pending).toBeNull();
    expect(third.lastScannedBlock).toBe(HEAD - CONFIRMATIONS - 1);
    expect([...(await loadSkipped('internal-transactions'))]).toEqual([swap.transaction.hash]);
    expect(
      await InternalTransaction.countDocuments({ transactionHash: swap.transaction.hash })
    ).toBe(0);
    expect(await InternalTransaction.countDocuments({})).toBe(19 - 12);
  });
});

describe('Geth call traces', () => {
  const A = '0x' + 'a'.repeat(40);
  const R = '0x' + 'b'.repeat(40);
  const W = '0x' + 'c'.repeat(40);
  const L = '0x' + 'd'.repeat(40);
  const C = '0x' + 'e'.repeat(40);
  const X = '0x' + '1'.repeat(40);
  const Y = '0x' + '2'.repeat(40);
  const B = '0x' + '3'.repeat(40);
  const tree: GethCallFrame = {
    type: 'CALL',
    from: A,
    to: R,
    value: '0x10',
    gas: '0x30000',
    gasUsed: '0x20000',
    input: '0x12345678',
    calls: [
      { type: 'CALL', from: R, to: W, value: '0x5', gas: '0x900', gasUsed: '0x0', input: '0x' },
      {
        type: 'DELEGATECALL',
        from: R,
        to: L,
        value: '0x10',
        gas: '0x8000',
        gasUsed: '0x7000',
        input: '0xabcdef01',
        calls: [
          {
            type: 'CREATE',
            from: R,
            to: C,
            value: '0x0',
            gas: '0x6000',
            gasUsed: '0x5000',
            input: '0x6080',
            output: '0x6000',
          },
        ],
      },
      {
        type: 'CALL',
        from: R,
        to: X,
        value: '0x0',
        gas: '0x1000',
        gasUsed: '0x1000',
        input: '0x',
        error: 'execution reverted',
        calls: [
          { type: 'CALL', from: X, to: Y, value: '0x1', gas: '0x800', gasUsed: '0x0', input: '0x' },
        ],
      },
      {
        type: 'SELFDESTRUCT',
        from: R,
        to: B,
        value: '0x7',
        gas: '0x0',
        gasUsed: '0x0',
        input: '0x',
      },
    ],
  };

  it('lists the frames depth first with Parity paths and subtrace counts', () => {
    const frames = parityTracesFromGethCallTrace(tree);
    expect(frames.map((frame) => [frame.type, frame.traceAddress, frame.subtraces])).toEqual([
      ['call', [], 4],
      ['call', [0], 0],
      ['call', [1], 1],
      ['create', [1, 0], 0],
      ['call', [2], 1],
      ['call', [2, 0], 0],
      ['suicide', [3], 0],
    ]);
    // value only moves in CALL / CALLCODE
    expect(frames[2].action).toMatchObject({ callType: 'delegatecall', value: '0x0' });
    expect(frames[3].result).toMatchObject({ address: C });
    expect(frames[4]).toMatchObject({ error: 'execution reverted', result: null });
  });

  it('becomes the same internal transactions as a Parity trace', () => {
    const docs = internalTransactionsFromTraces(parityTracesFromGethCallTrace(tree), {
      transactionHash: '0x' + 'f'.repeat(64),
      blockNumber: 10,
      blockHash: '0x' + '9'.repeat(64),
      transactionIndex: 0,
      timestamp: 1_760_000_000,
    });
    expect(docs.map((doc) => [doc.type, doc.callType, doc.to, doc.value, doc.reverted])).toEqual([
      ['call', 'call', W, '5', false],
      ['call', 'delegatecall', L, '0', false],
      ['create', null, null, '0', false],
      ['call', 'call', X, '0', true],
      ['call', 'call', Y, '1', true],
      ['selfdestruct', null, B, '7', false],
    ]);
    expect(docs[2]).toMatchObject({ createdContract: C });
  });

  it('switches to debug_traceTransaction on a node without trace_transaction', async () => {
    const seen: string[] = [];
    const node = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const call = JSON.parse(raw) as { id: number; method: string };
        seen.push(call.method);
        res.setHeader('content-type', 'application/json');
        const params = (JSON.parse(raw) as { params?: unknown[] }).params ?? [];
        if (call.method === 'eth_getTransactionByHash') {
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: call.id,
              result: {
                hash: params[0],
                blockHash: '0x' + '9'.repeat(64),
                blockNumber: '0xa',
                transactionIndex: '0x0',
              },
            })
          );
          return;
        }
        res.end(
          JSON.stringify(
            call.method === 'trace_transaction'
              ? {
                  jsonrpc: '2.0',
                  id: call.id,
                  error: {
                    code: -32601,
                    message: 'the method trace_transaction does not exist/is not available',
                  },
                }
              : { jsonrpc: '2.0', id: call.id, result: tree }
          )
        );
      });
    });
    await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
    const source = createTraceSource(`http://127.0.0.1:${(node.address() as AddressInfo).port}`);
    try {
      // the indexer traces several transactions at once: all of the first wave must switch
      const wave = await Promise.all(
        ['f', 'e', 'd'].map((digit) => source.traceTransaction('0x' + digit.repeat(64)))
      );
      expect(wave.map((frames) => frames?.length)).toEqual([7, 7, 7]);
      // every frame names its transaction and block, which the indexer checks
      expect(wave[0]?.[0]).toMatchObject({
        transactionHash: '0x' + 'f'.repeat(64),
        blockHash: '0x' + '9'.repeat(64),
        blockNumber: 10,
        transactionPosition: 0,
      });
      seen.length = 0;
      const second = await source.traceTransaction('0x' + 'c'.repeat(64));
      expect(second).toHaveLength(7);
      // after the first wave only debug_traceTransaction is asked (ethers also sends eth_chainId)
      expect(seen.filter((method) => method !== 'eth_chainId').sort()).toEqual([
        'debug_traceTransaction',
        'eth_getTransactionByHash',
      ]);
    } finally {
      source.close();
      await new Promise((resolve) => node.close(resolve));
    }
  });

  it('recognises missing-method errors', () => {
    expect(isMethodMissing({ error: { code: -32601, message: 'x' } })).toBe(true);
    expect(
      isMethodMissing(new Error('the method trace_transaction does not exist/is not available'))
    ).toBe(true);
    expect(isMethodMissing(new Error('execution timeout'))).toBe(false);
  });
});
