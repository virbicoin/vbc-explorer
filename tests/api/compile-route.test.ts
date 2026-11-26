/**
 * POST /api/compile `action: 'find'` only reads. It used to fill a missing compiler version with
 * '0.8.28' in the database (and report 'latest' as 0.8.30), so any caller could record a compiler
 * nobody had verified with.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Contract } from '@/models/index';
import { POST } from '@/app/api/compile/route';

let mongod: MongoMemoryServer;
let ipCounter = 0;

const UNKNOWN = `0x${'c0de'.padEnd(40, '0')}`;
const VERIFIED = `0x${'5afe'.padEnd(40, '0')}`;

async function find(addr: string) {
  ipCounter += 1;
  const request = new NextRequest('https://explorer.example/api/compile', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-ip': `198.51.100.${ipCounter}` },
    body: JSON.stringify({ addr, action: 'find' }),
  });
  const response = await POST(request, undefined as never);
  return response.json();
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('explorerDB_compile');
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
    { address: UNKNOWN, contractName: 'Unknown', verified: false },
    {
      address: VERIFIED,
      contractName: 'Token',
      verified: true,
      compilerVersion: 'v0.8.30+commit.73712a01',
    },
  ]);
});

describe('/api/compile find', () => {
  it('reports a missing compiler version as null and writes nothing', async () => {
    const body = await find(UNKNOWN);
    expect(body).toMatchObject({ valid: false, compilerVersion: null, address: UNKNOWN });
    const stored = await Contract.collection.findOne({ address: UNKNOWN });
    expect(stored).not.toHaveProperty('compilerVersion');
  });

  it('returns the stored version without the v prefix', async () => {
    const body = await find(VERIFIED);
    expect(body).toMatchObject({ valid: true, compilerVersion: '0.8.30+commit.73712a01' });
  });
});
