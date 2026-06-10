import mongoose from 'mongoose';
import { connectDB } from '../models/index';
import { logger } from './logger';

/**
 * Pure guard: returns true when a mongoose readyState means "connected".
 * Exported for unit testing.
 */
export function isConnected(readyState: number): boolean {
  return readyState === mongoose.ConnectionStates.connected;
}

/**
 * Connect to MongoDB.
 *
 * Delegates the actual connection to the canonical connector in
 * `models/index.ts` so the whole application shares a single, deterministic set
 * of connection options and environment handling (previously this module
 * duplicated its own URI resolution and option logic, which made the effective
 * options depend on whichever connector ran first).
 *
 * Returns the live mongoose Connection — some callers use `.collection()` on it
 * directly — and throws if the connection could not be established.
 */
async function dbConnect(): Promise<mongoose.Connection> {
  await connectDB();
  if (!isConnected(mongoose.connection.readyState)) {
    throw new Error('Database connection failed');
  }
  return mongoose.connection;
}

// Lightweight cleanup of the connection pool
export async function dbDisconnect() {
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.disconnected) {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  }
}

// Export both as default and named export for compatibility
export default dbConnect;
export const connectToDatabase = dbConnect;
