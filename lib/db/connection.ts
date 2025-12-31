/**
 * Database Connection Manager
 *
 * Singleton pattern for MongoDB connection to ensure
 * connection reuse across the application.
 */

import mongoose from 'mongoose';

interface ConnectionConfig {
  uri: string;
  dbName?: string;
  options?: mongoose.ConnectOptions;
}

class DatabaseConnection {
  private static instance: DatabaseConnection;
  private isConnected = false;
  private connectionPromise: Promise<typeof mongoose> | null = null;

  private constructor() {}

  static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  async connect(config?: ConnectionConfig): Promise<typeof mongoose> {
    // Return existing connection if already connected
    if (this.isConnected && mongoose.connection.readyState === 1) {
      return mongoose;
    }

    // Return pending connection promise if connecting
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    const uri = config?.uri || process.env.MONGO_URI || 'mongodb://localhost:27017';
    const dbName = config?.dbName || process.env.MONGO_DB || 'explorerDB';

    const options: mongoose.ConnectOptions = {
      dbName,
      maxPoolSize: 10,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      ...config?.options,
    };

    this.connectionPromise = mongoose
      .connect(uri, options)
      .then((mongooseInstance) => {
        this.isConnected = true;
        console.log(`MongoDB connected: ${dbName}`);
        return mongooseInstance;
      })
      .catch((error) => {
        this.connectionPromise = null;
        console.error('MongoDB connection error:', error);
        throw error;
      });

    // Setup connection event handlers
    mongoose.connection.on('disconnected', () => {
      this.isConnected = false;
      this.connectionPromise = null;
      console.log('MongoDB disconnected');
    });

    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    return this.connectionPromise;
  }

  async disconnect(): Promise<void> {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      this.isConnected = false;
      this.connectionPromise = null;
    }
  }

  getConnection(): mongoose.Connection {
    return mongoose.connection;
  }

  isConnectedToDb(): boolean {
    return this.isConnected && mongoose.connection.readyState === 1;
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
