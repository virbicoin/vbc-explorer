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

// Connection-string resolution (environment > config.json, never a default)
export {
  resolveMongoUri,
  substituteEnvPlaceholders,
  MongoUriConfigError,
  MissingMongoUriError,
  InvalidMongoUriError,
  type EnvVars,
  type ResolvedMongoUri,
  type ResolveMongoUriOptions,
} from './uri';

// Index management (schema is the single source of truth; see models/index.ts)
export {
  ensureModelIndexes,
  findMissingIndexes,
  countDuplicateKeys,
  listIndexNames,
  schemaIndexSpecs,
  indexNameFor,
  type IndexSpec,
  type EnsureIndexesResult,
  type EnsureIndexesOptions,
} from './indexes';

// Re-export existing connection for backward compatibility
export { default as dbConnect, connectToDatabase, dbDisconnect } from '../db';
