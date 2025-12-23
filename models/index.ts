import mongoose, { Schema, Document } from 'mongoose';

// 環境変数の設定
if (!process.env.MONGODB_URI) {
  process.env.MONGODB_URI = 'mongodb://localhost/explorerDB';
}

// Interfaces for TypeScript
export interface IBlock extends Document {
  number: number;
  hash: string;
  parentHash: string;
  nonce: string;
  sha3Uncles: string;
  logsBloom: string;
  transactionsRoot: string;
  stateRoot: string;
  receiptRoot: string;
  miner: string;
  difficulty: string;
  totalDifficulty: string;
  size: number;
  extraData: string;
  gasLimit: number;
  gasUsed: number;
  timestamp: number;
  blockTime: number;
  uncles: string[];
}

export interface ITransaction extends Document {
  hash: string;
  nonce: number;
  blockHash: string;
  blockNumber: number;
  transactionIndex: number;
  status: number;
  from: string;
  to: string;
  creates: string;
  value: string;
  gas: number;
  gasUsed: number;
  gasPrice: string;
  timestamp: number;
  input: string;
}

export interface IAccount extends Document {
  address: string;
  balance: string; // Changed from number to string
  blockNumber: number;
  type: number; // address: 0x0, contract: 0x1
}

export interface IBlockStat extends Document {
  number: number;
  timestamp: number;
  difficulty: string;
  hashrate: string;
  txCount: number;
  gasUsed: number;
  gasLimit: number;
  miner: string;
  blockTime: number;
  uncleCount: number;
}

export interface IContract extends Document {
  address: string;
  blockNumber: number;
  ERC: number; // 0:normal contract, 2:ERC20, 3:ERC223
  creationTransaction: string;
  contractName: string;
  tokenName: string;
  symbol: string;
  owner: string;
  decimals: number;
  totalSupply: number;
  compilerVersion: string;
  optimization: boolean;
  sourceCode: string;
  abi: string;
  byteCode: string;
}

export interface ITokenTransfer extends Document {
  hash: string;
  blockNumber: number;
  method: string;
  from: string;
  to: string;
  contract: string;
  value: string;
  timestamp: number;
}

export interface IMarket extends Document {
  symbol: string;
  timestamp: number;
  quoteBTC: number;
  quoteUSD: number;
}

// Schema definitions
const BlockSchema = new Schema({
  'number': { type: Number, index: { unique: true } },
  'hash': String,
  'parentHash': String,
  'nonce': String,
  'sha3Uncles': String,
  'logsBloom': String,
  'transactionsRoot': String,
  'stateRoot': String,
  'receiptRoot': String,
  'miner': { type: String, lowercase: true },
  'difficulty': String,
  'totalDifficulty': String,
  'size': Number,
  'extraData': String,
  'gasLimit': Number,
  'gasUsed': Number,
  'timestamp': Number,
  'blockTime': Number,
  'uncles': [String],
}, { collection: 'Block' });

const AccountSchema = new Schema({
  'address': { type: String, index: { unique: true } },
  'balance': String, // Changed from Number to String to avoid scientific notation
  'blockNumber': Number,
  'type': { type: Number, default: 0 }, // address: 0x0, contract: 0x1
}, { collection: 'Account' });

const ContractSchema = new Schema({
  'address': { type: String, index: { unique: true } },
  'blockNumber': Number,
  'ERC': { type: Number, index: true }, //0:normal contract, 2:ERC20, 3:ERC223
  'creationTransaction': String,
  'contractName': String,
  'tokenName': String,
  'symbol': String,
  'owner': String,
  'decimals': Number,
  'totalSupply': Number,
  'compilerVersion': String,
  'optimization': Boolean,
  'sourceCode': String,
  'abi': String,
  'byteCode': String,
  'verified': { type: Boolean, default: false },
  'verifiedAt': { type: Date },
}, { collection: 'Contract' });

const TransactionSchema = new Schema({
  'hash': { type: String, index: { unique: true }, lowercase: true },
  'nonce': Number,
  'blockHash': String,
  'blockNumber': Number,
  'transactionIndex': Number,
  'status': Number,
  'from': { type: String, lowercase: true },
  'to': { type: String, lowercase: true },
  'creates': { type: String, lowercase: true },
  'value': String,
  'gas': Number,
  'gasUsed': Number,
  'gasPrice': String,
  'timestamp': Number,
  'input': String,
}, { collection: 'Transaction' });

// Note: Compound indexes will be created programmatically via create-indexes script
// to avoid duplicate index warnings. Individual field indexes are handled above.

const TokenTransferSchema = new Schema({
  'hash': { type: String, index: { unique: true }, lowercase: true },
  'blockNumber': Number,
  'method': String,
  'from': { type: String, lowercase: true },
  'to': { type: String, lowercase: true },
  'contract': { type: String, lowercase: true },
  'value': String,
  'timestamp': Number,
}, { collection: 'TokenTransfer' });

const BlockStatSchema = new Schema({
  'number': { type: Number, index: { unique: true } },
  'timestamp': Number,
  'difficulty': String,
  'hashrate': String,
  'txCount': Number,
  'gasUsed': Number,
  'gasLimit': Number,
  'miner': String,
  'blockTime': Number,
  'uncleCount': Number,
}, { collection: 'BlockStat' });

const MarketSchema = new Schema({
  'symbol': String,
  'timestamp': Number,
  'quoteBTC': Number,
  'quoteUSD': Number,
}, { collection: 'Market' });

// Create indices
// Optimized transaction indexes for homepage queries
TransactionSchema.index({ blockNumber: -1 });
TransactionSchema.index({ blockNumber: -1, transactionIndex: -1 }, { background: true });
TransactionSchema.index({ from: 1, blockNumber: -1 });
TransactionSchema.index({ to: 1, blockNumber: -1 });
TransactionSchema.index({ creates: 1, blockNumber: -1 });
AccountSchema.index({ balance: -1 });
AccountSchema.index({ balance: -1, blockNumber: -1 });
AccountSchema.index({ type: -1, balance: -1 });
BlockSchema.index({ miner: 1 });
BlockSchema.index({ miner: 1, blockNumber: -1 });
BlockSchema.index({ hash: 1, number: -1 });
MarketSchema.index({ timestamp: -1 });
TokenTransferSchema.index({ blockNumber: -1 });
TokenTransferSchema.index({ from: 1, blockNumber: -1 });
TokenTransferSchema.index({ to: 1, blockNumber: -1 });
TokenTransferSchema.index({ contract: 1, blockNumber: -1 });

// Database connection
let connectionPromise: Promise<void> | null = null;

export const connectDB = async (): Promise<void> => {
  // If already connected, return immediately
  if (mongoose.connection.readyState === 1) {
    return;
  }

  // If connection is in progress, wait for it
  if (connectionPromise) {
    return connectionPromise;
  }

  // Create new connection promise
  connectionPromise = (async () => {
    try {
      mongoose.set('strictQuery', false);

      if (mongoose.connection.readyState === 0) {
        // Try to load config.json for database URI
        let uri = process.env.MONGODB_URI || 'mongodb://localhost/explorerDB';
        
        try {
          const fs = await import('fs');
          const path = await import('path');
          const configPath = path.join(process.cwd(), 'config.json');
          if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.database && config.database.uri) {
              uri = config.database.uri;
              console.log('📄 Using MongoDB URI from config.json');
              
              // Validate URI format
              if (!uri.includes('mongodb://')) {
                throw new Error('Invalid MongoDB URI format');
              }
            }
          }
        } catch (configError) {
          console.log('📄 Using default MongoDB URI');
        }

        // Optimized database connection options for t4g.small (2GB RAM)
        let dbOptions: mongoose.ConnectOptions = {
          maxPoolSize: 5,   // Minimal pool for 2GB RAM
          minPoolSize: 1,   // Single connection minimum
          serverSelectionTimeoutMS: 120000, // 2 minutes for slow instances
          socketTimeoutMS: 180000, // 3 minutes for slow operations
          connectTimeoutMS: 120000, // 2 minutes for slow connections
          retryWrites: true,
          retryReads: true,
          bufferCommands: true, // Queue commands during reconnection
          autoIndex: false,      // Disable auto indexing in production
          autoCreate: false,     // Disable auto creation in production
          heartbeatFrequencyMS: 30000,  // 30 seconds to reduce overhead
          maxIdleTimeMS: 120000,  // 2 minutes to keep connections alive
          waitQueueTimeoutMS: 180000, // 3 minutes wait for connections
        };

        try {
          const fs = await import('fs');
          const path = await import('path');
          const configPath = path.join(process.cwd(), 'config.json');
          if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.database && config.database.options) {
              dbOptions = { ...dbOptions, ...config.database.options };
              console.log('📄 Using database options from config.json');
            }
          }
        } catch (configError) {
          console.log('📄 Using default database options');
        }

        const connectionOptions = dbOptions;
        
        console.log('🔗 Connecting to MongoDB...');
        await mongoose.connect(uri, connectionOptions);
        console.log('✅ MongoDB connected successfully');
      }
    } catch (error) {
      if (mongoose.connection.readyState === 1) {
        return;
      }
      console.error('❌ MongoDB connection error:', error);
      // Clear the promise so retry is possible
      connectionPromise = null;
      // Don't throw error, just log it and continue
      console.log('⚠️ Continuing without database connection...');
    }
    // Note: Don't clear connectionPromise on success to prevent race conditions
  })();

  return connectionPromise;
};

// Models
export const Block = mongoose.models.Block || mongoose.model<IBlock>('Block', BlockSchema);
export const Account = mongoose.models.Account || mongoose.model<IAccount>('Account', AccountSchema);
export const Contract = mongoose.models.Contract || mongoose.model<IContract>('Contract', ContractSchema);
export const Transaction = mongoose.models.Transaction || mongoose.model<ITransaction>('Transaction', TransactionSchema);
export const TokenTransfer = mongoose.models.TokenTransfer || mongoose.model<ITokenTransfer>('TokenTransfer', TokenTransferSchema);
export const BlockStat = mongoose.models.BlockStat || mongoose.model<IBlockStat>('BlockStat', BlockStatSchema);
export const Market = mongoose.models.Market || mongoose.model<IMarket>('Market', MarketSchema);

// Default export for convenience
const models = {
  connectDB,
  Block,
  Account,
  Contract,
  Transaction,
  TokenTransfer,
  BlockStat,
  Market,
};

export default models;
