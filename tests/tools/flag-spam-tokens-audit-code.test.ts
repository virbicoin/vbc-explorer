/**
 * `flag-spam-tokens --audit-code` against mongodb-memory-server with a stubbed
 * eth_getCode: addresses without code are hidden with reason 'no-code',
 * addresses that have token transfers are only reported, already hidden
 * records keep their reason, errors are counted, and the automatic name pass
 * never un-hides a no-code record.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Contract, Token, TokenTransfer } from '@/models/index';
import { auditNoCode, classifyCollection } from '../../tools/flag-spam-tokens';

let mongod: MongoMemoryServer;

const WITH_CODE = '0x1111111111111111111111111111111111111111';
const EOA = '0x47c93fd5a9fdf1516ffeabb74d0b5a44786d7026'; // token + contract record, no code
const DESTROYED = '0x2222222222222222222222222222222222222222'; // no code but transfers exist
const ALREADY = '0x3333333333333333333333333333333333333333'; // hidden (url-name), no code
const CONTRACT_ONLY = '0x4444444444444444444444444444444444444444'; // Contract record only, no code
const FAILING = '0x5555555555555555555555555555555555555555'; // eth_getCode throws
const CODE = '0x6080604052';

const getCode = async (address: string): Promise<string> => {
  if (address === FAILING) throw new Error('node timeout');
  return address === WITH_CODE ? CODE : '0x';
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('explorerDB_audit_code');
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
    { address: WITH_CODE, name: 'Wrapped VBC', symbol: 'WVBC', hidden: false },
    { address: EOA, name: 'Unknown', symbol: 'UNKNOWN', totalSupply: '0', hidden: false },
    { address: DESTROYED, name: 'Gone Token', symbol: 'GONE', hidden: false },
    {
      address: ALREADY,
      name: 'http://127.0.0.1:2375/version',
      symbol: 'X',
      hidden: true,
      hiddenReason: 'url-name',
    },
    { address: FAILING, name: 'Flaky', symbol: 'FLK', hidden: false },
  ]);
  await Contract.collection.insertMany([
    { address: EOA, contractName: 'Unknown', symbol: 'UNKNOWN', hidden: false },
    { address: CONTRACT_ONLY, contractName: 'Typo Contract', hidden: false },
    { address: WITH_CODE, contractName: 'Wrapped VBC', symbol: 'WVBC', hidden: false },
  ]);
  await TokenTransfer.collection.insertOne({
    tokenAddress: DESTROYED,
    transactionHash: '0xt1',
    from: '0xa',
    to: '0xb',
    value: '1',
    blockNumber: 10,
    timestamp: new Date(),
  });
});

describe('auditNoCode', () => {
  it('lists addresses without code and writes nothing in a dry run', async () => {
    const result = await auditNoCode(true, { getCode, batchSize: 2 });
    expect(result.checked).toBe(6);
    expect(result.withCode).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.noCode.map((e) => e.address).sort()).toEqual(
      [EOA, ALREADY, CONTRACT_ONLY].sort()
    );
    expect(result.needsReview.map((e) => e.address)).toEqual([DESTROYED]);
    expect(result.noCode.find((e) => e.address === EOA)).toMatchObject({
      collections: ['tokens', 'Contract'],
      name: 'Unknown',
      symbol: 'UNKNOWN',
      alreadyHidden: false,
    });
    expect(result.noCode.find((e) => e.address === ALREADY)?.alreadyHidden).toBe(true);
    expect(result.hidden).toBe(3); // EOA in both collections + CONTRACT_ONLY: would be hidden
    expect((await Token.findOne({ address: EOA }).lean())?.hidden).toBe(false);
    expect((await Contract.findOne({ address: CONTRACT_ONLY }).lean())?.hidden).toBe(false);
  });

  it('hides no-code records with reason no-code, keeps transfers and existing reasons untouched', async () => {
    const result = await auditNoCode(false, { getCode });
    expect(result.hidden).toBe(3);
    expect(await Token.findOne({ address: EOA }).lean()).toMatchObject({
      hidden: true,
      hiddenReason: 'no-code',
    });
    expect(await Contract.findOne({ address: EOA }).lean()).toMatchObject({
      hidden: true,
      hiddenReason: 'no-code',
    });
    expect(await Contract.findOne({ address: CONTRACT_ONLY }).lean()).toMatchObject({
      hidden: true,
      hiddenReason: 'no-code',
    });
    // the self-destruct candidate and the contract with code stay visible
    expect((await Token.findOne({ address: DESTROYED }).lean())?.hidden).toBe(false);
    expect((await Token.findOne({ address: WITH_CODE }).lean())?.hidden).toBe(false);
    expect((await Token.findOne({ address: FAILING }).lean())?.hidden).toBe(false);
    // an existing flag keeps its original reason
    expect(await Token.findOne({ address: ALREADY }).lean()).toMatchObject({
      hidden: true,
      hiddenReason: 'url-name',
    });
    // nothing was deleted
    expect(await Token.countDocuments({})).toBe(5);
    expect(await Contract.countDocuments({})).toBe(3);

    // a second run changes nothing more
    const again = await auditNoCode(false, { getCode });
    expect(again.hidden).toBe(0);
    expect(again.noCode.every((e) => e.alreadyHidden)).toBe(true);
  });

  it('is not undone by the automatic name classification', async () => {
    await auditNoCode(false, { getCode });
    const pass = await classifyCollection(Token, false);
    expect(pass.changes.map((c) => c.address)).not.toContain(EOA);
    expect(await Token.findOne({ address: EOA }).lean()).toMatchObject({
      hidden: true,
      hiddenReason: 'no-code',
    });
  });
});
