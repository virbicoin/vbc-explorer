/**
 * Database Connection Manager
 *
 * Thin wrapper around the single connector in `models/index.ts` (connectDB).
 * There is exactly one `mongoose.connect()` in the codebase; pool sizes,
 * timeouts, `autoIndex: false` and the URI resolution (environment >
 * config.json, no default: see lib/db/uri.ts) live there and in
 * `config.database.options`. This
 * module only keeps the historical API (`db`, `connectDatabase`,
 * `disconnectDatabase`) used through `lib/db`.
 */

import mongoose from 'mongoose';
import { connectDB } from '../../models/index';
import { logger } from '../logger';

interface ConnectionConfig {
  /** Ignored: the connection string comes from MONGODB_URI / config.json. */
  uri?: string;
  /** Ignored: the database is part of the URI. */
  dbName?: string;
  /** Ignored: pool and timeout options come from config.database.options. */
  options?: mongoose.ConnectOptions;
}

class DatabaseConnection {
  private static instance: DatabaseConnection;

  private constructor() {}

  static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  /** Connect through models/index.ts `connectDB()`; per-call options are not supported. */
  async connect(config?: ConnectionConfig): Promise<typeof mongoose> {
    if (config && Object.keys(config).length > 0) {
      logger.warn('connectDatabase(): per-call options are ignored; configure config.database', {
        keys: Object.keys(config),
      });
    }
    await connectDB();
    if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected) {
      throw new Error('Database connection failed');
    }
    return mongoose;
  }

  async disconnect(): Promise<void> {
    if (mongoose.connection.readyState !== mongoose.ConnectionStates.disconnected) {
      await mongoose.disconnect();
    }
  }

  getConnection(): mongoose.Connection {
    return mongoose.connection;
  }

  isConnectedToDb(): boolean {
    return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
  }
}

// Export singleton instance
export const db = DatabaseConnection.getInstance();

// Export helper function for easy access
export async function connectDatabase(config?: ConnectionConfig): Promise<typeof mongoose> {
  return db.connect(config);
}

export async function disconnectDatabase(): Promise<void> {
  return db.disconnect();
}

// Re-export mongoose for direct access when needed
export { mongoose };
