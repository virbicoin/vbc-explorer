import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { isConnected } from '@/lib/db';
import { connectDatabase, db, disconnectDatabase } from '@/lib/db/connection';
import { connectDB } from '@/models/index';

describe('isConnected', () => {
  it('returns true only for the mongoose "connected" readyState', () => {
    expect(isConnected(mongoose.ConnectionStates.connected)).toBe(true);
  });

  it('returns false for disconnected/connecting/disconnecting states', () => {
    expect(isConnected(mongoose.ConnectionStates.disconnected)).toBe(false);
    expect(isConnected(mongoose.ConnectionStates.connecting)).toBe(false);
    expect(isConnected(mongoose.ConnectionStates.disconnecting)).toBe(false);
  });
});

describe('lib/db/connection delegates to the single connector', () => {
  let mongod: MongoMemoryServer;
  let uri: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri('explorerDB_connection');
    process.env.MONGODB_URI = uri;
  }, 180_000);

  afterAll(async () => {
    await disconnectDatabase();
    if (mongod) await mongod.stop();
  });

  it('connectDatabase() opens the same default connection as connectDB()', async () => {
    const instance = await connectDatabase({ options: { maxPoolSize: 1 } });
    expect(instance).toBe(mongoose);
    expect(db.isConnectedToDb()).toBe(true);
    expect(db.getConnection()).toBe(mongoose.connection);
    expect(mongoose.connection.db?.databaseName).toBe('explorerDB_connection');

    // connectDB() sees the connection as established: no second connection is made
    await connectDB();
    expect(mongoose.connection.readyState).toBe(mongoose.ConnectionStates.connected);
    expect(mongoose.connections.filter((c) => c.readyState === 1)).toHaveLength(1);
  });
});
