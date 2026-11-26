import mongoose, { Schema, Document } from 'mongoose';
import { logger } from '../lib/logger';
import {
  ensureModelIndexes,
  findMissingIndexes,
  emptyEnsureIndexesResult,
  type AnyModel,
  type EnsureIndexesOptions,
  type EnsureIndexesResult,
  type IndexSpec,
} from '../lib/db/indexes';
import { MongoUriConfigError, resolveMongoUri } from '../lib/db/uri';

/*
 * Model and index policy
 * ----------------------
 * - Every Mongoose model lives in this file. Do not define models inline
 *   (`mongoose.models.X || mongoose.model('X', schema)`) anywhere else;
 *   import them from here instead.
 * - Every collection name is set explicitly via `{ collection }` and matches
 *   the production database (Block, Transaction, Account, Contract, BlockStat,
 *   Market, DexSwap, VerificationJob, tokens, tokentransfers, tokenholders,
 *   scan_progress, InternalTransaction).
 * - Indexes are declared on the schemas below and nowhere else. They are
 *   created explicitly by `ensureIndexes()` (called by the data-writing CLI
 *   tools on startup and by `npm run optimize-indexes`), never by `autoIndex`
 *   and never from the Next.js app. Existing indexes are never dropped.
 */

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
  /** Wei created for the block's uncles (uncle + nephew rewards); only on blocks with uncles. */
  uncleReward?: string;
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
  /** solc `optimizer.runs` the verified source was compiled with (200 when the input left it out). */
  optimizationRuns?: number;
  /** solc `settings.evmVersion` of the verification; 'default' when the input left it to the compiler. */
  evmVersion?: string;
  /** SPDX identifier chosen at verification (or read from the source). */
  license?: string;
  sourceCode: string;
  abi: string;
  byteCode: string;
  verified: boolean;
  verifiedAt?: Date;
  /** Hidden from lists (name/symbol looks like a URL, control chars, HTML, too long, or manual). */
  hidden?: boolean;
  hiddenReason?: string | null;
}

/** Token metadata (collection `tokens`, written by tools/tokens.ts and the Launchpad APIs). */
export interface IToken extends Document {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  holders: number;
  type: string;
  supply: string;
  verified: boolean;
  logoUrl: string | null;
  metadata?: {
    logoUrl?: string;
    description?: string;
    website?: string;
  };
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  source?: string;
  /** Launchpad factory that created the token (lib/launchpad/factory.ts). */
  factory?: string | null;
  /** True when a factory vouched for the token, false when an audit found no factory that knows it. */
  factoryVerified?: boolean;
  /** Hidden from lists (see lib/security/display-name.ts). */
  hidden?: boolean;
  hiddenReason?: string | null;
}

/** Token balance per holder (collection `tokenholders`). */
export interface ITokenHolder extends Document {
  tokenAddress: string;
  holderAddress: string;
  balance: string;
  percentage: number;
  rank: number;
}

/**
 * ERC-20 / NFT Transfer event (collection `tokentransfers`, written by tools/tokens.ts).
 * `tokenId` is only set for NFT transfers, `logIndex` for VRC-20 and VRC-1155 transfers
 * (one document per event); `timestamp` is a Date.
 *
 * VRC-1155 transfers (lib/sync/erc1155.ts) carry `tokenType: 'VRC-1155'`, one document
 * per token id of a TransferSingle / TransferBatch event (`batchIndex`), the amount in
 * `value` and the id as a decimal string in `tokenId` (ids are uint256). They are written
 * and filtered through the driver, so Mongoose never casts that string to a number.
 */
export interface ITokenTransfer extends Document {
  tokenAddress: string;
  transactionHash: string;
  from: string;
  to: string;
  value: string;
  tokenId?: number | string;
  /** Position of the event in its block; absent on VRC-721 documents and on VRC-20 documents stored before 2026-11. */
  logIndex?: number;
  blockNumber: number;
  timestamp: Date;
  /** 'VRC-1155' on VRC-1155 transfers, absent otherwise. */
  tokenType?: string;
  /** VRC-1155: position of the id inside a TransferBatch event (0 for TransferSingle). */
  batchIndex?: number;
  /** VRC-1155: the address that moved the tokens (`operator` of the event). */
  operator?: string;
}

/**
 * A call, contract creation or selfdestruct made inside a transaction (collection
 * `InternalTransaction`, written by tools/internal-txs.ts from the node's call traces).
 * Every frame of a trace except the top-level call is stored, as on Blockscout.
 */
export interface IInternalTransaction extends Document {
  transactionHash: string;
  /** Position of the frame in the transaction's trace (0 = the transaction itself). */
  index: number;
  traceAddress: number[];
  blockNumber: number;
  blockHash: string;
  transactionIndex: number;
  /** Block time, unix seconds (as Transaction.timestamp). */
  timestamp: number;
  /** call | create | create2 | selfdestruct */
  type: string;
  /** call | callcode | delegatecall | staticcall; null unless `type` is call. */
  callType: string | null;
  from: string;
  /** Callee, or the beneficiary of a selfdestruct; null for a creation. */
  to: string | null;
  /** Address of the contract a successful creation made. */
  createdContract?: string;
  /** Wei, decimal string. */
  value: string;
  gas: string;
  gasUsed: string | null;
  /** The frame's own error ("Reverted", "Out of gas", ...). */
  error: string | null;
  /** True when this frame or one that encloses it failed, so nothing it did took effect. */
  reverted: boolean;
}

/**
 * Progress markers (collection `scan_progress`): `tokens` (tools/tokens.ts),
 * `sync` (live listener position), `reorg-pending` (reorg deeper than
 * maxReorgDepth, with the range in `meta`), `repair` (tools/repair-chain.ts),
 * `internal-transactions` (tools/internal-txs.ts) and `erc1155` (tools/tokens.ts),
 * the last two with the range fields of lib/sync/range-scan.ts.
 */
export interface IScanProgress extends Document {
  scanType: string;
  lastScannedBlock: number;
  lastUpdateTime: Date;
  meta?: Record<string, unknown> | null;
  generation?: number;
  inFlightTo?: number | null;
  skipped?: Array<{ blockNumber: number; transactionHash: string; reason: string; at?: Date }>;
}

export interface IMarket extends Document {
  symbol: string;
  timestamp: number;
  quoteBTC: number;
  quoteUSD: number;
  /** Where tools/price.ts read the quote from (rows written before this field have none). */
  source?: string;
}

// DEX Swap Event Interface
export interface IDexSwap extends Document {
  hash: string;
  blockNumber: number;
  timestamp: number;
  pair: string; // LP token address
  sender: string;
  to: string;
  amount0In: string;
  amount1In: string;
  amount0Out: string;
  amount1Out: string;
  token0: string;
  token1: string;
  amountUSD: number;
  priceUSD: number; // Price of base token at time of swap
}

// Verification Job Interface (for Etherscan-compatible API)
export interface IVerificationJob extends Document {
  guid: string;
  address: string;
  status: 'pending' | 'pass' | 'fail';
  message: string;
  sourceCode: string;
  codeFormat: string;
  contractName: string;
  compilerVersion: string;
  optimizationUsed: boolean;
  runs: number;
  constructorArguments: string;
  evmVersion: string;
  licenseType: string;
  libraries: string;
  createdAt: Date;
  updatedAt: Date;
}

// Schema definitions
const BlockSchema = new Schema(
  {
    number: { type: Number, index: { unique: true } },
    hash: { type: String, lowercase: true, index: { unique: true } },
    parentHash: String,
    nonce: String,
    sha3Uncles: String,
    logsBloom: String,
    transactionsRoot: String,
    stateRoot: String,
    receiptRoot: String,
    miner: { type: String, lowercase: true },
    difficulty: String,
    totalDifficulty: String,
    size: Number,
    extraData: String,
    gasLimit: Number,
    gasUsed: Number,
    timestamp: Number,
    blockTime: Number,
    uncles: [String],
    uncleReward: String,
  },
  { collection: 'Block' }
);

const AccountSchema = new Schema(
  {
    address: { type: String, lowercase: true, index: { unique: true } },
    balance: String, // Changed from Number to String to avoid scientific notation
    blockNumber: Number,
    type: { type: Number, default: 0 }, // address: 0x0, contract: 0x1
  },
  { collection: 'Account' }
);

const ContractSchema = new Schema(
  {
    address: { type: String, lowercase: true, index: { unique: true } },
    blockNumber: Number,
    ERC: Number, //0:normal contract, 2:ERC20, 3:ERC223
    creationTransaction: String,
    contractName: String,
    tokenName: String,
    symbol: String,
    owner: String,
    decimals: Number,
    totalSupply: Number,
    compilerVersion: String,
    optimization: Boolean,
    // Settings of the verification. They were not in the schema before 2026-11, so Mongoose
    // dropped them on save and records verified earlier do not have them.
    optimizationRuns: Number,
    evmVersion: String,
    license: String,
    sourceCode: String,
    abi: String,
    byteCode: String,
    verified: { type: Boolean, default: false },
    verifiedAt: { type: Date },
    hidden: { type: Boolean, default: false },
    hiddenReason: { type: String, default: null },
  },
  { collection: 'Contract' }
);

const TransactionSchema = new Schema(
  {
    hash: { type: String, index: { unique: true }, lowercase: true },
    nonce: Number,
    blockHash: String,
    blockNumber: Number,
    transactionIndex: Number,
    status: Number,
    from: { type: String, lowercase: true },
    to: { type: String, lowercase: true },
    creates: { type: String, lowercase: true },
    value: String,
    gas: Number,
    gasUsed: Number,
    gasPrice: String,
    timestamp: Number,
    input: String,
  },
  { collection: 'Transaction' }
);

// Token Schema (collection `tokens`; superset of the fields every writer uses)
const TokenSchema = new Schema(
  {
    address: { type: String, lowercase: true, index: { unique: true } },
    name: String,
    symbol: String,
    decimals: { type: Number, default: 18 },
    totalSupply: String,
    holders: { type: Number, default: 0 },
    type: String,
    supply: String,
    verified: { type: Boolean, default: false },
    logoUrl: { type: String, default: null },
    metadata: {
      logoUrl: String,
      description: String,
      website: String,
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    createdBy: String, // Creator address (Launchpad; chain value from the factory)
    source: String, // 'launchpad' or 'scan'
    factory: { type: String, lowercase: true, default: null }, // Launchpad factory that created the token
    factoryVerified: Boolean, // true: factory vouched; false: audit found no factory; unset: never checked
    hidden: { type: Boolean, default: false },
    hiddenReason: { type: String, default: null },
  },
  { collection: 'tokens' }
);

// Token Holder Schema (collection `tokenholders`)
const TokenHolderSchema = new Schema(
  {
    tokenAddress: { type: String, lowercase: true },
    holderAddress: { type: String, lowercase: true },
    balance: String,
    percentage: { type: Number, default: 100 },
    rank: { type: Number, default: 1 },
  },
  { collection: 'tokenholders' }
);

// Token Transfer Schema (collection `tokentransfers`; written by tools/tokens.ts)
const TokenTransferSchema = new Schema(
  {
    tokenAddress: { type: String, lowercase: true },
    transactionHash: { type: String, lowercase: true },
    from: { type: String, lowercase: true },
    to: { type: String, lowercase: true },
    value: String,
    // NFT only. VRC-721 documents hold a number; VRC-1155 documents a decimal string, written
    // and queried through the driver (lib/sync/erc1155.ts) so this cast never applies to them.
    tokenId: Number,
    logIndex: Number, // VRC-20 / VRC-1155: position of the event in its block (lib/sync/token-transfers.ts, erc1155.ts)
    blockNumber: Number,
    timestamp: Date,
    tokenType: String, // 'VRC-1155' on VRC-1155 transfers only
    batchIndex: Number, // VRC-1155: position of the id in a TransferBatch event
    operator: { type: String, lowercase: true }, // VRC-1155: operator of the event
  },
  { collection: 'tokentransfers' }
);

// Internal transaction schema (collection `InternalTransaction`; tools/internal-txs.ts)
const InternalTransactionSchema = new Schema(
  {
    transactionHash: { type: String, lowercase: true },
    index: Number,
    traceAddress: [Number],
    blockNumber: Number,
    blockHash: { type: String, lowercase: true },
    transactionIndex: Number,
    timestamp: Number,
    type: String,
    callType: { type: String, default: null },
    from: { type: String, lowercase: true },
    to: { type: String, lowercase: true, default: null },
    createdContract: { type: String, lowercase: true },
    value: String,
    gas: String,
    gasUsed: { type: String, default: null },
    error: { type: String, default: null },
    reverted: Boolean,
  },
  { collection: 'InternalTransaction' }
);

// Scan Progress Schema (collection `scan_progress`; tools/tokens.ts)
const ScanProgressSchema = new Schema(
  {
    scanType: { type: String, index: { unique: true } }, // 'tokens' | 'sync' | 'reorg-pending' | 'repair' | 'launchpad-sync' | 'internal-transactions' | 'erc1155'
    lastScannedBlock: { type: Number, default: 0 },
    lastUpdateTime: { type: Date, default: Date.now },
    meta: { type: Schema.Types.Mixed, default: null },
    // Range indexers only (lib/sync/range-scan.ts): bumped by replaceBlock() when it rewrites
    // a height the indexer covered or is working on, the end of that working range, and the
    // transactions it gave up on.
    generation: Number,
    inFlightTo: Number,
    skipped: { type: [Schema.Types.Mixed], default: undefined },
  },
  { collection: 'scan_progress' }
);

const BlockStatSchema = new Schema(
  {
    number: { type: Number, index: { unique: true } },
    timestamp: Number,
    difficulty: String,
    hashrate: String,
    txCount: Number,
    gasUsed: Number,
    gasLimit: Number,
    miner: String,
    blockTime: Number,
    uncleCount: Number,
  },
  { collection: 'BlockStat' }
);

const MarketSchema = new Schema(
  {
    symbol: String,
    timestamp: Number,
    quoteBTC: Number,
    quoteUSD: Number,
    source: String,
  },
  { collection: 'Market' }
);

// DEX Swap Event Schema
const DexSwapSchema = new Schema(
  {
    hash: { type: String, lowercase: true },
    blockNumber: Number,
    timestamp: Number,
    pair: { type: String, lowercase: true },
    sender: { type: String, lowercase: true },
    to: { type: String, lowercase: true },
    amount0In: String,
    amount1In: String,
    amount0Out: String,
    amount1Out: String,
    token0: { type: String, lowercase: true },
    token1: { type: String, lowercase: true },
    amountUSD: Number,
    priceUSD: Number,
  },
  { collection: 'DexSwap' }
);

// Verification Job Schema (for Etherscan-compatible API)
const VerificationJobSchema = new Schema(
  {
    guid: { type: String, index: { unique: true } },
    address: { type: String, lowercase: true },
    status: { type: String, enum: ['pending', 'pass', 'fail'], default: 'pending' },
    message: { type: String, default: '' },
    sourceCode: String,
    codeFormat: { type: String, default: 'solidity-single-file' },
    contractName: String,
    compilerVersion: String,
    optimizationUsed: { type: Boolean, default: false },
    runs: { type: Number, default: 200 },
    constructorArguments: { type: String, default: '' },
    // '' = not given: standard JSON input keeps its own settings, single files compile for paris
    evmVersion: { type: String, default: '' },
    licenseType: { type: String, default: '' },
    libraries: { type: String, default: '' },
  },
  { collection: 'VerificationJob', timestamps: true }
);

/*
 * Indexes
 * -------
 * Every index below is backed by a real query (the README "Database indexes"
 * section lists the evidence). Unique single-field indexes are declared on
 * the paths above: Block.number, Block.hash, Transaction.hash,
 * Account.address, Contract.address, BlockStat.number, VerificationJob.guid,
 * tokens.address, scan_progress.scanType.
 */

// Block: mined-block lists by miner (address API `mining`, blockscout `getminedblocks`,
// search/blocks-by-miner) and per-day block counts (stats/daily, blockscout getblocknobytime).
BlockSchema.index({ miner: 1, number: -1 });
BlockSchema.index({ timestamp: -1 });
// Block: total uncle issuance for the supply endpoints (lib/supply.ts sums uncleReward
// over the blocks that have it). Sparse: only blocks with uncles carry the field.
BlockSchema.index({ uncleReward: 1 }, { sparse: true });

// Transaction: latest-transaction lists and per-block lookups (transactions, v2, realtime),
// per-address history (address API, v2 addresses, blockscout account, CSV export),
// contract-creation lookups (contract/status, blockscout getcontractcreation),
// per-day / 24h counts (stats/daily, v2/stats).
TransactionSchema.index({ blockNumber: -1, transactionIndex: -1 });
TransactionSchema.index({ from: 1, blockNumber: -1, transactionIndex: -1 });
TransactionSchema.index({ to: 1, blockNumber: -1, transactionIndex: -1 });
TransactionSchema.index({ creates: 1, blockNumber: -1 }, { sparse: true });
TransactionSchema.index({ timestamp: -1 });

// Account: richlist `$match: { balance: { $gt: '0' } }`.
AccountSchema.index({ balance: -1 });

// Contract / tokens: list APIs filter `hidden: { $ne: true }` (spam-name flag).
ContractSchema.index({ hidden: 1 });
TokenSchema.index({ hidden: 1 });

// Market: latest price lookups (`findOne().sort({ timestamp: -1 })`).
MarketSchema.index({ timestamp: -1 });

// DexSwap: swap sync upsert key (tools/price.ts), per-pool OHLCV / trades / 24h stats,
// 24h trader and volume aggregations by timestamp.
DexSwapSchema.index({ hash: 1, pair: 1 }, { unique: true });
DexSwapSchema.index({ pair: 1, timestamp: -1 });
DexSwapSchema.index({ pair: 1, blockNumber: -1 });
DexSwapSchema.index({ timestamp: -1 });

// tokentransfers: per-token history/first transfer (token API, NFT ownership),
// per-address history (address API, CSV export), transfers of a transaction (tx API),
// NFT sync upsert key (tools/tokens.ts: tokenAddress + tokenId + blockNumber + to).
TokenTransferSchema.index({ tokenAddress: 1, timestamp: -1 });
TokenTransferSchema.index({ from: 1, timestamp: -1 });
TokenTransferSchema.index({ to: 1, timestamp: -1 });
TokenTransferSchema.index({ transactionHash: 1 });
TokenTransferSchema.index({ tokenAddress: 1, tokenId: 1, blockNumber: 1, to: 1 });
// tokentransfers: VRC-1155 sync rewrites a block range at a time (lib/sync/erc1155.ts).
// Sparse: only VRC-1155 documents carry tokenType.
TokenTransferSchema.index({ tokenType: 1, blockNumber: 1 }, { sparse: true });

// InternalTransaction: the frames of a transaction in trace order (tx APIs, writer key),
// newest-first lists of the chain and of a block, block ranges (Etherscan startblock /
// endblock, the indexer's range rewrite), and per-address lists (from / to / created).
InternalTransactionSchema.index({ transactionHash: 1, index: 1 }, { unique: true });
InternalTransactionSchema.index({ blockNumber: -1, transactionIndex: -1, index: -1 });
InternalTransactionSchema.index({ from: 1, blockNumber: -1, transactionIndex: -1, index: -1 });
InternalTransactionSchema.index({ to: 1, blockNumber: -1, transactionIndex: -1, index: -1 });
InternalTransactionSchema.index({ createdContract: 1, blockNumber: -1 }, { sparse: true });

// tokenholders: holder upsert key (tools/tokens.ts, Launchpad), holder ranking of a token
// (token API sorts by `rank`), tokens held by an address (address API `tokens`).
TokenHolderSchema.index({ tokenAddress: 1, holderAddress: 1 }, { unique: true });
TokenHolderSchema.index({ tokenAddress: 1, rank: 1 });
TokenHolderSchema.index({ holderAddress: 1 });

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
  const attempt = (async () => {
    try {
      mongoose.set('strictQuery', false);

      if (mongoose.connection.readyState === 0) {
        // Environment variable, then config.json (`${VAR}` substituted). There is
        // no default: a missing URI throws MissingMongoUriError (lib/db/uri.ts)
        // instead of connecting to an unauthenticated localhost.
        const { uri, source } = resolveMongoUri();
        console.log(`📄 Using MongoDB URI from ${source}`);

        // Optimized database connection options for t4g.small (2GB RAM)
        let dbOptions: mongoose.ConnectOptions = {
          maxPoolSize: 5, // Minimal pool for 2GB RAM
          minPoolSize: 1, // Single connection minimum
          serverSelectionTimeoutMS: 120000, // 2 minutes for slow instances
          socketTimeoutMS: 180000, // 3 minutes for slow operations
          connectTimeoutMS: 120000, // 2 minutes for slow connections
          retryWrites: true,
          retryReads: true,
          bufferCommands: true, // Queue commands during reconnection
          autoIndex: false, // Indexes are created explicitly by ensureIndexes(), never automatically
          autoCreate: false, // Disable auto creation in production
          heartbeatFrequencyMS: 30000, // 30 seconds to reduce overhead
          maxIdleTimeMS: 120000, // 2 minutes to keep connections alive
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
      // Clear the promise so retry is possible
      connectionPromise = null;
      if (error instanceof MongoUriConfigError) {
        // Configuration error: stop immediately, never fall back to a default URI
        console.error(`❌ ${error.message}`);
        throw error;
      }
      console.error('❌ MongoDB connection error:', error);
      // Don't throw error, just log it and continue
      console.log('⚠️ Continuing without database connection...');
    }
    // Note: Don't clear connectionPromise on success to prevent race conditions
  })();
  connectionPromise = attempt;
  // A configuration error is thrown before the first await, i.e. before the
  // assignment above: clear the cached rejection so the next call retries.
  attempt.catch(() => {
    if (connectionPromise === attempt) connectionPromise = null;
  });

  return attempt;
};

// Models
export const Block = mongoose.models.Block || mongoose.model<IBlock>('Block', BlockSchema);
export const Account =
  mongoose.models.Account || mongoose.model<IAccount>('Account', AccountSchema);
export const Contract =
  mongoose.models.Contract || mongoose.model<IContract>('Contract', ContractSchema);
export const Transaction =
  mongoose.models.Transaction || mongoose.model<ITransaction>('Transaction', TransactionSchema);
export const TokenTransfer =
  mongoose.models.TokenTransfer ||
  mongoose.model<ITokenTransfer>('TokenTransfer', TokenTransferSchema);
export const BlockStat =
  mongoose.models.BlockStat || mongoose.model<IBlockStat>('BlockStat', BlockStatSchema);
export const Market = mongoose.models.Market || mongoose.model<IMarket>('Market', MarketSchema);
export const DexSwap =
  mongoose.models.DexSwap || mongoose.model<IDexSwap>('DexSwap', DexSwapSchema);
export const VerificationJob =
  mongoose.models.VerificationJob ||
  mongoose.model<IVerificationJob>('VerificationJob', VerificationJobSchema);
export const Token = mongoose.models.Token || mongoose.model<IToken>('Token', TokenSchema);
export const TokenHolder =
  mongoose.models.TokenHolder || mongoose.model<ITokenHolder>('TokenHolder', TokenHolderSchema);
export const ScanProgress =
  mongoose.models.ScanProgress || mongoose.model<IScanProgress>('ScanProgress', ScanProgressSchema);
export const InternalTransaction =
  mongoose.models.InternalTransaction ||
  mongoose.model<IInternalTransaction>('InternalTransaction', InternalTransactionSchema);

/** Every model defined in this file (the set `ensureIndexes()` operates on). */
export const ALL_MODELS: readonly AnyModel[] = [
  Block,
  Transaction,
  Account,
  Contract,
  BlockStat,
  Market,
  DexSwap,
  VerificationJob,
  Token,
  TokenHolder,
  TokenTransfer,
  ScanProgress,
  InternalTransaction,
];

/** Model name → real collection name (e.g. `TokenTransfer` → `tokentransfers`). */
export const MODEL_COLLECTIONS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(ALL_MODELS.map((model) => [model.modelName, model.collection.name]))
);

/** True when `SKIP_INDEX_SYNC` asks to skip index creation (`1`, `true`, `yes`). */
export function isIndexSyncSkipped(env: Record<string, string | undefined> = process.env): boolean {
  const value = (env.SKIP_INDEX_SYNC || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

/**
 * Create every index declared on the schemas above that is missing from the
 * database. Existing indexes are never dropped, unique indexes are skipped
 * (and reported) when duplicate keys exist, and nothing is thrown: callers
 * keep running and read the result. Set `SKIP_INDEX_SYNC=1` to do nothing.
 *
 * Call this from data-writing tools right after `connectDB()`; the Next.js
 * app must not call it.
 */
export async function ensureIndexes(
  options: EnsureIndexesOptions = {}
): Promise<EnsureIndexesResult> {
  if (isIndexSyncSkipped()) {
    logger.info('Index sync skipped (SKIP_INDEX_SYNC is set)');
    return emptyEnsureIndexesResult();
  }
  return ensureModelIndexes([...ALL_MODELS], options);
}

/** Schema-declared indexes that are missing from the database (read-only). */
export async function checkIndexes(): Promise<IndexSpec[]> {
  return findMissingIndexes([...ALL_MODELS]);
}

let startupIndexSync: Promise<EnsureIndexesResult> | null = null;

/**
 * `ensureIndexes()` for tool startup: logs a summary and never throws, so a
 * sync tool keeps running even when index creation fails. Runs at most once
 * per process; concurrent or repeated calls share the first run.
 */
export function ensureIndexesOnStartup(tool: string): Promise<EnsureIndexesResult> {
  if (!startupIndexSync) {
    startupIndexSync = runStartupIndexSync(tool);
  }
  return startupIndexSync;
}

async function runStartupIndexSync(tool: string): Promise<EnsureIndexesResult> {
  try {
    const result = await ensureIndexes();
    logger.info('Index sync summary', {
      tool,
      created: result.created,
      existing: result.existing.length,
      skipped: result.skipped.map((s) => `${s.collection}.${s.index} (${s.reason})`),
      failed: result.failed.map((f) => `${f.collection}.${f.index} (${f.error})`),
    });
    return result;
  } catch (error) {
    logger.warn('Index sync failed; continuing without it', {
      tool,
      error: error instanceof Error ? error.message : String(error),
    });
    return emptyEnsureIndexesResult();
  }
}

// Default export for convenience
const models = {
  connectDB,
  ensureIndexes,
  checkIndexes,
  Block,
  Account,
  Contract,
  Transaction,
  TokenTransfer,
  BlockStat,
  Market,
  DexSwap,
  VerificationJob,
  Token,
  TokenHolder,
  ScanProgress,
  InternalTransaction,
};

export default models;
