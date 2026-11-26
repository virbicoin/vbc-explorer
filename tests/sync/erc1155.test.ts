/**
 * VRC-1155 transfers (lib/sync/erc1155.ts): decoding TransferSingle /
 * TransferBatch logs, balances per id, the range sync with token discovery
 * through ERC-165, holders, and the progress marker. A fake node serves the
 * logs and eth_call answers. mongodb-memory-server.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  encodeAbiParameters,
  encodeFunctionResult,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toFunctionSelector,
  toHex,
} from 'viem';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Block, Contract, ScanProgress, Token, TokenHolder, TokenTransfer } from '@/models/index';
import {
  TRANSFER_BATCH_TOPIC,
  TRANSFER_SINGLE_TOPIC,
  erc1155Balances,
  erc1155TransfersFromLog,
  syncErc1155Range,
  syncErc1155ToConfirmedHead,
  type Erc1155Node,
  type RawLog,
} from '@/lib/sync/erc1155';

const pad = (prefix: string, length: number) => `0x${prefix.padEnd(length, '0')}`;
const topic = (address: string) => `0x${'0'.repeat(24)}${address.slice(2)}`;
const MULTI = pad('e1155', 40);
const IMPOSTOR = pad('e0000', 40); // emits the event, does not claim ERC-1155
const GONE = pad('dead', 40); // claims ERC-1155, has no code any more
const OPERATOR = pad('0e', 40);
const ALICE = pad('a11ce', 40);
const BOB = pad('b0b', 40);
const ZERO = pad('', 40);
const BIG_ID = (2n ** 255n + 7n).toString();
const views = parseAbi([
  'function supportsInterface(bytes4) view returns (bool)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
]);
const selectorOf = (name: string) => toFunctionSelector(views.find((item) => item.name === name)!);

let logCounter = 0;
function single(
  address: string,
  block: number,
  from: string,
  to: string,
  id: bigint,
  value: bigint
): RawLog {
  logCounter += 1;
  return {
    address,
    topics: [TRANSFER_SINGLE_TOPIC, topic(OPERATOR), topic(from), topic(to)],
    data: encodeAbiParameters(parseAbiParameters('uint256, uint256'), [id, value]),
    blockNumber: `0x${block.toString(16)}`,
    transactionHash: pad(`${block}`, 64),
    logIndex: `0x${logCounter.toString(16)}`,
  };
}
function batch(
  address: string,
  block: number,
  from: string,
  to: string,
  ids: bigint[],
  values: bigint[]
): RawLog {
  logCounter += 1;
  return {
    address,
    topics: [TRANSFER_BATCH_TOPIC, topic(OPERATOR), topic(from), topic(to)],
    data: encodeAbiParameters(parseAbiParameters('uint256[], uint256[]'), [ids, values]),
    blockNumber: `0x${block.toString(16)}`,
    transactionHash: pad(`b${block}`, 64),
    logIndex: `0x${logCounter.toString(16)}`,
  };
}

class FakeNode implements Erc1155Node {
  logs: RawLog[] = [];
  supports = new Set<string>([MULTI, GONE]);
  code = new Set<string>([MULTI, IMPOSTOR]);
  calls = 0;
  async getLogs(fromBlock: number, toBlock: number, topics: string[][]) {
    return this.logs.filter((log) => {
      const height = Number(BigInt(log.blockNumber));
      return height >= fromBlock && height <= toBlock && topics[0].includes(log.topics[0]);
    });
  }
  async call(to: string, data: string) {
    this.calls += 1;
    const selector = data.slice(0, 10);
    if (selector === selectorOf('supportsInterface')) {
      return encodeFunctionResult({
        abi: views,
        functionName: 'supportsInterface',
        result: this.supports.has(to),
      });
    }
    if (to !== MULTI) return null;
    if (selector === selectorOf('name')) {
      return encodeFunctionResult({ abi: views, functionName: 'name', result: 'Game Items' });
    }
    if (selector === selectorOf('symbol')) {
      return encodeFunctionResult({ abi: views, functionName: 'symbol', result: 'ITEM' });
    }
    return null;
  }
  async getCode(address: string) {
    return this.code.has(address) ? '0x6080' : '0x';
  }
}

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('explorerDB_erc1155'), { autoIndex: false });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
  await Block.collection.insertMany(
    Array.from({ length: 31 }, (_, number) => ({
      number,
      hash: pad(`h${number}`, 64),
      timestamp: 1_760_000_000 + number,
    }))
  );
});

describe('erc1155TransfersFromLog', () => {
  it('reads a TransferSingle event, keeping a uint256 id exactly', () => {
    const log = single(MULTI, 5, ZERO, ALICE, BigInt(BIG_ID), 3n);
    expect(erc1155TransfersFromLog(log, 1_760_000_005)).toEqual([
      {
        tokenType: 'VRC-1155',
        tokenAddress: MULTI,
        transactionHash: pad('5', 64),
        logIndex: Number(BigInt(log.logIndex)),
        batchIndex: 0,
        blockNumber: 5,
        timestamp: new Date(1_760_000_005_000),
        operator: OPERATOR,
        from: ZERO,
        to: ALICE,
        tokenId: BIG_ID,
        value: '3',
      },
    ]);
  });

  it('reads one document per id of a TransferBatch event', () => {
    const docs = erc1155TransfersFromLog(batch(MULTI, 6, ALICE, BOB, [1n, 2n], [10n, 20n]), 1);
    expect(docs.map((doc) => [doc.batchIndex, doc.tokenId, doc.value])).toEqual([
      [0, '1', '10'],
      [1, '2', '20'],
    ]);
  });

  it('ignores removed, foreign and malformed logs', () => {
    const log = single(MULTI, 5, ZERO, ALICE, 1n, 1n);
    expect(erc1155TransfersFromLog({ ...log, removed: true }, 1)).toEqual([]);
    expect(
      erc1155TransfersFromLog(
        { ...log, topics: [keccak256(toHex('Other()')), ...log.topics.slice(1)] },
        1
      )
    ).toEqual([]);
    expect(erc1155TransfersFromLog({ ...log, data: '0x1234' }, 1)).toEqual([]);
    expect(erc1155TransfersFromLog({ ...log, topics: log.topics.slice(0, 3) }, 1)).toEqual([]);
  });
});

describe('erc1155Balances', () => {
  it('nets transfers per holder and id and drops what is gone', () => {
    const balances = erc1155Balances([
      { from: ZERO, to: ALICE, tokenId: '1', value: '10' },
      { from: ALICE, to: BOB, tokenId: '1', value: '3' },
      { from: BOB, to: ZERO, tokenId: '1', value: '3' },
      { from: ZERO, to: BOB, tokenId: '2', value: '1' },
    ]);
    expect([...balances.keys()].sort()).toEqual([ALICE, BOB].sort());
    expect([...balances.get(ALICE)!]).toEqual([['1', 7n]]);
    expect([...balances.get(BOB)!]).toEqual([['2', 1n]]);
  });
});

describe('syncErc1155Range', () => {
  it('registers ERC-165 VRC-1155 contracts and stores their transfers and holders', async () => {
    const node = new FakeNode();
    node.logs = [
      single(MULTI, 5, ZERO, ALICE, 1n, 10n),
      batch(MULTI, 6, ALICE, BOB, [1n, BigInt(BIG_ID)], [4n, 0n]),
      single(MULTI, 7, ZERO, ALICE, BigInt(BIG_ID), 2n),
      single(IMPOSTOR, 7, ZERO, ALICE, 1n, 1n),
      single(GONE, 8, ZERO, BOB, 1n, 1n),
    ];
    const result = await syncErc1155Range(node, 0, 20);
    expect(result).toMatchObject({
      logs: 5,
      transfers: 4,
      registered: [MULTI],
      touchedTokens: [MULTI],
    });

    expect(await Token.findOne({ address: MULTI }).lean()).toMatchObject({
      type: 'VRC-1155',
      name: 'Game Items',
      symbol: 'ITEM',
      decimals: 0,
      holders: 2,
      totalSupply: '12',
    });
    expect(await Contract.findOne({ address: MULTI }).lean()).toMatchObject({ ERC: 1155 });
    expect(await Token.countDocuments({ address: { $in: [IMPOSTOR, GONE] } })).toBe(0);

    const stored = await TokenTransfer.collection.find({ tokenType: 'VRC-1155' }).toArray();
    expect(stored).toHaveLength(4);
    expect(stored.every((doc) => typeof doc.tokenId === 'string')).toBe(true);
    expect(stored.map((doc) => doc.tokenId)).toContain(BIG_ID);

    const holders = (await TokenHolder.find({ tokenAddress: MULTI })
      .sort({ rank: 1 })
      .lean()) as Array<{
      holderAddress: string;
      balance: string;
      rank: number;
    }>;
    // ALICE: 10 − 4 of id 1 plus 2 of the big id; BOB: 4 of id 1
    expect(holders.map((holder) => [holder.holderAddress, holder.balance, holder.rank])).toEqual([
      [ALICE, '8', 1],
      [BOB, '4', 2],
    ]);
  });

  it('rewrites the range as a whole and can be repeated', async () => {
    const node = new FakeNode();
    node.logs = [single(MULTI, 5, ZERO, ALICE, 1n, 10n), single(MULTI, 9, ALICE, BOB, 1n, 1n)];
    await syncErc1155Range(node, 0, 20);
    await TokenTransfer.collection.insertOne({
      tokenType: 'VRC-1155',
      tokenAddress: MULTI,
      blockNumber: 12,
    });
    // an orphaned block's event is gone from the node
    node.logs = node.logs.slice(0, 1);
    const again = await syncErc1155Range(node, 0, 20);
    expect(again.transfers).toBe(1);
    expect(await TokenTransfer.collection.countDocuments({ tokenType: 'VRC-1155' })).toBe(1);
    expect(await TokenHolder.countDocuments({ tokenAddress: MULTI })).toBe(1);
    // VRC-20 / VRC-721 documents of the range are not touched
    await TokenTransfer.collection.insertOne({
      tokenAddress: pad('f', 40),
      blockNumber: 5,
      value: '1',
    });
    await syncErc1155Range(node, 0, 20);
    expect(await TokenTransfer.collection.countDocuments({ tokenType: { $exists: false } })).toBe(
      1
    );
  });

  it('keeps a contract that is already listed as another standard out of the VRC-1155 sync', async () => {
    await Token.collection.insertOne({ address: MULTI, type: 'VRC-721', name: 'Listed' });
    const node = new FakeNode();
    node.logs = [single(MULTI, 5, ZERO, ALICE, 1n, 1n)];
    const result = await syncErc1155Range(node, 0, 20);
    expect(result).toMatchObject({ transfers: 0, registered: [] });
    expect(node.calls).toBe(0);
  });
});

describe('syncErc1155ToConfirmedHead', () => {
  it('follows the confirmed head with its own marker', async () => {
    const node = new FakeNode();
    node.logs = [single(MULTI, 5, ZERO, ALICE, 1n, 10n), single(MULTI, 25, ZERO, BOB, 1n, 1n)];
    const result = await syncErc1155ToConfirmedHead(node, { confirmations: 3, rangeBlocks: 7 });
    // head 30 − 3 confirmations − 1
    expect(result.lastScannedBlock).toBe(26);
    expect(result.transfers).toBe(2);
    expect(result.registered).toEqual([MULTI]);
    expect(
      (await ScanProgress.findOne({ scanType: 'erc1155' }).lean()) as { lastScannedBlock: number }
    ).toMatchObject({ lastScannedBlock: 26, inFlightTo: null });
    const again = await syncErc1155ToConfirmedHead(node, { confirmations: 3 });
    expect(again.ranges).toBe(0);
  });
});
