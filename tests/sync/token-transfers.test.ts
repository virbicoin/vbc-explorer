/**
 * VRC-20 transfers are stored one document per event (transaction hash + log
 * index), and the documents written under the former key (transaction hash +
 * token) are replaced only after the token's whole history has been stored
 * again. mongodb-memory-server.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  TRANSFER_TOPIC,
  erc20TransferFromLog,
  erc20TransferUpserts,
  storeErc20Transfers,
  type Erc20TransferDoc,
  type TransferCollection,
} from '@/lib/sync/token-transfers';

let mongod: MongoMemoryServer;

const pad = (prefix: string, length: number) => `0x${prefix.padEnd(length, '0')}`;
const topic = (address: string) => `0x${'0'.repeat(24)}${address.slice(2)}`;
const TOKEN = pad('f001', 40);
const OTHER_TOKEN = pad('f002', 40);
const NFT = pad('f003', 40);
const PAIR = pad('aa', 40);
const USER = pad('bb', 40);
const ZERO = pad('', 40);
const SWAP = pad('1', 64);
const LATER = pad('2', 64);

const collection = () =>
  mongoose.connection.db!.collection('tokentransfers') as unknown as TransferCollection & {
    find(filter: object): { toArray(): Promise<Array<Record<string, unknown>>> };
    insertMany(docs: object[]): Promise<unknown>;
  };

const transfer = (
  transactionHash: string,
  logIndex: number,
  from: string,
  to: string,
  value: string
): Erc20TransferDoc => ({
  tokenAddress: TOKEN,
  transactionHash,
  logIndex,
  blockNumber: 100,
  from,
  to,
  value,
  timestamp: new Date(1_760_000_000_000),
});

// removing liquidity: the LP token goes from the user to the pair and is then burned
const HISTORY = [
  transfer(SWAP, 3, USER, PAIR, '500'),
  transfer(SWAP, 5, PAIR, ZERO, '500'),
  transfer(LATER, 0, ZERO, USER, '40'),
];

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('explorerDB_transfers'), {
    autoIndex: false,
    autoCreate: false,
  });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
});

describe('erc20TransferFromLog', () => {
  const log = {
    topics: [TRANSFER_TOPIC, topic(USER), topic(PAIR)],
    data: '0x01f4',
    blockNumber: 100n,
    transactionHash: SWAP.toUpperCase().replace('0X', '0x'),
    logIndex: 3n,
  };

  it('builds the document of one event', () => {
    expect(
      erc20TransferFromLog(log, TOKEN.toUpperCase().replace('0X', '0x'), 1_760_000_000n)
    ).toEqual(transfer(SWAP, 3, USER, PAIR, '500'));
  });

  it('reads an event without data as an amount of zero', () => {
    expect(erc20TransferFromLog({ ...log, data: '0x' }, TOKEN, 1_760_000_000)?.value).toBe('0');
  });

  it('returns null for a log that does not identify an event', () => {
    expect(erc20TransferFromLog({ ...log, topics: [TRANSFER_TOPIC] }, TOKEN, 1)).toBeNull();
    expect(erc20TransferFromLog({ ...log, logIndex: undefined }, TOKEN, 1)).toBeNull();
    expect(erc20TransferFromLog({ ...log, transactionHash: undefined }, TOKEN, 1)).toBeNull();
  });
});

describe('storeErc20Transfers', () => {
  it('keeps every transfer of a transaction that moves the token more than once', async () => {
    const result = await storeErc20Transfers(collection(), TOKEN, HISTORY, { complete: true });
    expect(result).toEqual({ stored: 3, legacyRemoved: 0 });
    const inSwap = await collection().find({ transactionHash: SWAP }).toArray();
    expect(inSwap.map((doc) => doc.logIndex).sort()).toEqual([3, 5]);
  });

  it('is idempotent', async () => {
    await storeErc20Transfers(collection(), TOKEN, HISTORY, { complete: true, batchSize: 2 });
    await storeErc20Transfers(collection(), TOKEN, HISTORY, { complete: true, batchSize: 2 });
    expect(await collection().find({}).toArray()).toHaveLength(3);
  });

  it('keys an event by transaction hash and log index', () => {
    expect(erc20TransferUpserts([HISTORY[0]])[0].updateOne.filter).toEqual({
      transactionHash: SWAP,
      logIndex: 3,
    });
  });

  describe('with documents stored under the former key', () => {
    beforeEach(async () => {
      await collection().insertMany([
        // one document for the transaction although it moved the token twice
        {
          tokenAddress: TOKEN,
          transactionHash: SWAP,
          from: PAIR,
          to: ZERO,
          value: '500',
          blockNumber: 100,
        },
        {
          tokenAddress: TOKEN,
          transactionHash: LATER,
          from: ZERO,
          to: USER,
          value: '40',
          blockNumber: 101,
        },
        // another token, not synced in this run
        {
          tokenAddress: OTHER_TOKEN,
          transactionHash: SWAP,
          from: USER,
          to: PAIR,
          value: '7',
          blockNumber: 100,
        },
        // NFT transfers never carry a log index
        {
          tokenAddress: NFT,
          transactionHash: LATER,
          from: ZERO,
          to: USER,
          tokenId: 9,
          blockNumber: 101,
        },
        {
          tokenAddress: TOKEN,
          transactionHash: LATER,
          from: ZERO,
          to: USER,
          tokenId: 1,
          blockNumber: 101,
        },
      ]);
    });

    it('replaces them once the whole history of the token is stored', async () => {
      const result = await storeErc20Transfers(collection(), TOKEN, HISTORY, { complete: true });
      expect(result).toEqual({ stored: 3, legacyRemoved: 2 });

      const ofToken = await collection().find({ tokenAddress: TOKEN, tokenId: null }).toArray();
      expect(ofToken).toHaveLength(3);
      expect(ofToken.every((doc) => typeof doc.logIndex === 'number')).toBe(true);
      // untouched: the other token, the NFT collection, and an NFT-style row of this address
      expect(await collection().find({ tokenAddress: OTHER_TOKEN }).toArray()).toHaveLength(1);
      expect(await collection().find({ tokenAddress: NFT }).toArray()).toHaveLength(1);
      expect(await collection().find({ tokenAddress: TOKEN, tokenId: 1 }).toArray()).toHaveLength(
        1
      );
    });

    it('keeps them when the history could not be read completely', async () => {
      const result = await storeErc20Transfers(collection(), TOKEN, [HISTORY[0]], {
        complete: false,
      });
      expect(result).toEqual({ stored: 1, legacyRemoved: 0 });
      const ofToken = await collection().find({ tokenAddress: TOKEN, tokenId: null }).toArray();
      expect(ofToken.filter((doc) => doc.logIndex === undefined)).toHaveLength(2);
      expect(ofToken.filter((doc) => doc.logIndex === 3)).toHaveLength(1);
    });
  });
});
