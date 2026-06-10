/**
 * Database Module Exports
 *
 * Central export point for all database-related functionality.
 */

// Connection management
export { db, connectDatabase, disconnectDatabase, mongoose } from './connection';

// Base repository
export { BaseRepository, type PaginationOptions, type PaginatedResult } from './base-repository';

// Native Db handle helpers
export { assertDb, requireDb, tryGetDb, getDb } from './get-db';

// Re-export existing connection for backward compatibility
export { default as dbConnect, connectToDatabase, dbDisconnect } from '../db';
