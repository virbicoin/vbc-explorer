/**
 * Native Db handle helpers
 *
 * Centralizes access to the underlying MongoDB `Db` handle that is otherwise
 * obtained ad-hoc via `mongoose.connection.db` across the codebase. Using these
 * helpers gives a single, consistent error message and one place to evolve the
 * access strategy later.
 *
 * - `assertDb`  — pure guard, throws when the handle is missing (testable).
 * - `requireDb` — returns the current handle or throws (assumes the caller has
 *                 already established a connection via one of the connectors).
 * - `tryGetDb`  — returns the current handle or `undefined` (drop-in for the
 *                 ad-hoc `mongoose.connection.db` access; never throws).
 * - `getDb`     — ensures a connection (canonical `dbConnect`) then returns the
 *                 handle; convenient for new code.
 */

import mongoose from 'mongoose';
import dbConnect from '../db';

/**
 * Native `Db` type of the driver bundled with mongoose. Import it from here
 * (not from the `mongodb` package) so the type always matches
 * `mongoose.connection.db`, even when another copy of the driver is installed.
 */
export type Db = mongoose.mongo.Db;

const NO_DB_MESSAGE = 'Database connection not established';

/**
 * Pure guard: returns the handle when present, otherwise throws.
 * Exported separately so it can be unit-tested without a live connection.
 */
export function assertDb(db: Db | undefined | null): Db {
  if (!db) {
    throw new Error(NO_DB_MESSAGE);
  }
  return db;
}

/**
 * Return the current native Db handle, throwing if it is unavailable.
 * Does not initiate a connection; callers are expected to have connected first.
 */
export function requireDb(): Db {
  return assertDb(mongoose.connection.db);
}

/**
 * Return the current native Db handle or `undefined` when not connected.
 * Drop-in replacement for direct `mongoose.connection.db` access; never throws.
 */
export function tryGetDb(): Db | undefined {
  return mongoose.connection.db;
}

/**
 * Ensure a connection is established and return the native Db handle.
 */
export async function getDb(): Promise<Db> {
  await dbConnect();
  return requireDb();
}
