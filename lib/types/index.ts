/**
 * Centralized Type Definitions
 *
 * Single source of truth for all TypeScript interfaces used across the application.
 * Import from here instead of defining types in multiple places.
 */

// ============================================================================
// Blockchain Core Types
// ============================================================================

export interface Block {
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

export interface Transaction {
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

export interface Account {
  address: string;
  balance: string;
  blockNumber: number;
  type: AccountType;
}

export enum AccountType {
  Address = 0,
  Contract = 1,
}

// ============================================================================
// Contract Types
// ============================================================================

export interface Contract {
  address: string;
  blockNumber: number;
  ERC: ERCType;
  creationTransaction: string;
  contractName: string;
  tokenName: string;
  symbol: string;
  owner: string;
  decimals: number;
  totalSupply: string;
  compilerVersion: string;
  optimization: boolean;
  sourceCode: string;
  abi: string;
  byteCode: string;
  verified?: boolean;
  verifiedAt?: Date;
}

export enum ERCType {
  Normal = 0,
  ERC20 = 2,
  ERC721 = 3,
  ERC1155 = 4,
}

// ============================================================================
// Token Types
// ============================================================================

export type TokenType =
  | 'VRC-20'
  | 'VRC-721'
  | 'VRC-1155'
  | 'ERC20'
  | 'ERC721'
  | 'ERC1155'
  | 'Native';

export interface Token {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  supply?: string;
  holders: number;
  type: TokenType;
  verified?: boolean;
  logoUrl?: string;
  description?: string;
  website?: string;
}

export interface TokenTransfer {
  transactionHash: string;
  blockNumber: number;
  from: string;
  to: string;
  tokenAddress: string;
  value: string;
  timestamp: Date;
  tokenId?: number;
  type?: TokenType;
}

export interface TokenHolder {
  tokenAddress: string;
  holderAddress: string;
  balance: string;
  rank: number;
  percentage?: number;
  tokenIds?: number[];
}

// ============================================================================
// NFT Types
// ============================================================================

export interface NftItem {
  tokenId: number;
  owner: string;
}

export interface NftMetadata {
  name?: string;
  description?: string;
  image?: string;
  attributes?: Array<{
    trait_type: string;
    value: string | number;
  }>;
  external_url?: string;
  animation_url?: string;
}

export interface NftOwnershipResult {
  ownership: Map<number, string>;
  totalSupply: number;
  items: NftItem[];
}

// ============================================================================
// Statistics Types
// ============================================================================

export interface BlockStat {
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

export interface ChainStats {
  blockHeight: number;
  difficulty: string;
  hashrate: string;
  totalSupply: string;
  circulatingSupply: string;
  totalTransactions: number;
  totalAccounts: number;
  avgBlockTime: number;
  avgGasPrice: string;
}

export interface Market {
  symbol: string;
  timestamp: number;
  quoteBTC: number;
  quoteUSD: number;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  error?: string;
}

export interface TokenApiResponse {
  token: {
    address: string;
    name: string;
    symbol: string;
    type: TokenType;
    decimals: number;
    totalSupply: string;
    totalSupplyRaw: string;
    isNFT: boolean;
    verified?: boolean;
    description?: string;
    logoUrl?: string;
    creator?: string;
    owner?: string;
  };
  contract?: {
    verified: boolean;
    compiler: string | null;
    language: string | null;
    name: string;
    sourceCode: string | null;
  };
  statistics?: {
    holders: number;
    totalTransfers: number;
    transfers24h: number;
    age: number | string;
    marketCap: string;
  };
  holders?: Array<{
    rank: number;
    address: string;
    balance: string;
    balanceRaw: string;
    percentage: string;
    tokenIds?: number[];
  }>;
  transfers?: Array<{
    hash: string;
    from: string;
    to: string;
    value: string;
    valueRaw: string;
    timestamp: string;
    timeAgo: string;
    tokenId?: string;
  }>;
  nftItems?: NftItem[];
  pagination?: {
    holders: PaginationInfo;
    transfers: PaginationInfo;
    nfts?: PaginationInfo;
  };
}

// ============================================================================
// Utility Types
// ============================================================================

export type Address = `0x${string}`;

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';
export const DEAD_ADDRESS: Address = '0x000000000000000000000000000000000000dead';

export function isZeroAddress(address: string): boolean {
  return address.toLowerCase() === ZERO_ADDRESS;
}

export function isDeadAddress(address: string): boolean {
  return address.toLowerCase() === DEAD_ADDRESS;
}

export function isBurnAddress(address: string): boolean {
  return isZeroAddress(address) || isDeadAddress(address);
}
