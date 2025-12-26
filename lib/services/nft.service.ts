/**
 * NFT Service - Centralized business logic for NFT operations
 * 
 * This service provides shared functionality for NFT ownership calculation
 * used by both API routes and CLI tools.
 */

import type { Db } from 'mongodb';

export const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
export const DEAD_ADDR = '0x000000000000000000000000000000000000dead';

export interface TokenTransfer {
  tokenId: number;
  from: string;
  to: string;
  blockNumber: number;
  transactionHash: string;
  timestamp: Date;
  value: string;
  tokenAddress: string;
}

export interface TokenOwnershipResult {
  /** Map of tokenId -> owner address */
  ownership: Map<number, string>;
  /** Total count of existing (non-burned) tokens */
  totalSupply: number;
  /** Array of all NFT items with owner */
  items: Array<{ tokenId: number; owner: string }>;
}

export interface HolderTokenIds {
  /** Map of holder address -> array of owned tokenIds */
  holderTokens: Map<string, number[]>;
}

/**
 * Calculate NFT ownership from transfer history
 * 
 * @param transfers - Array of token transfers sorted by timestamp (ascending)
 * @returns TokenOwnershipResult with ownership map, supply count, and items array
 */
export function calculateNftOwnership(transfers: TokenTransfer[]): TokenOwnershipResult {
  const ownership = new Map<number, string>();
  
  for (const transfer of transfers) {
    if (transfer.tokenId === undefined || transfer.tokenId === null) {
      continue;
    }
    
    const tokenId = Number(transfer.tokenId);
    
    // Burn: transfer to zero address removes ownership
    if (transfer.to.toLowerCase() === ZERO_ADDR || transfer.to.toLowerCase() === DEAD_ADDR) {
      ownership.delete(tokenId);
    } else {
      ownership.set(tokenId, transfer.to.toLowerCase());
    }
  }
  
  // Convert to items array sorted by tokenId descending
  const items: Array<{ tokenId: number; owner: string }> = [];
  for (const [tokenId, owner] of ownership.entries()) {
    items.push({ tokenId, owner });
  }
  items.sort((a, b) => b.tokenId - a.tokenId);
  
  return {
    ownership,
    totalSupply: ownership.size,
    items
  };
}

/**
 * Group tokens by holder address
 * 
 * @param ownership - Map of tokenId -> owner address
 * @returns Map of holder address -> array of owned tokenIds
 */
export function groupTokensByHolder(ownership: Map<number, string>): HolderTokenIds {
  const holderTokens = new Map<string, number[]>();
  
  for (const [tokenId, owner] of ownership.entries()) {
    const normalizedOwner = owner.toLowerCase();
    const tokens = holderTokens.get(normalizedOwner) || [];
    tokens.push(tokenId);
    holderTokens.set(normalizedOwner, tokens);
  }
  
  // Sort tokenIds within each holder
  for (const [holder, tokens] of holderTokens.entries()) {
    holderTokens.set(holder, tokens.sort((a, b) => a - b));
  }
  
  return { holderTokens };
}

/**
 * Fetch and calculate NFT ownership from database
 * 
 * @param db - MongoDB database instance
 * @param tokenAddress - Token contract address
 * @returns TokenOwnershipResult
 */
export async function getNftOwnershipFromDb(
  db: Db,
  tokenAddress: string
): Promise<TokenOwnershipResult> {
  // Fetch all transfers sorted by timestamp
  const transfers = await db.collection('tokentransfers').find({
    tokenAddress: { $regex: new RegExp(`^${tokenAddress}$`, 'i') },
    tokenId: { $exists: true, $ne: null }
  }).sort({ timestamp: 1 }).toArray();
  
  // Map to TokenTransfer interface
  const mappedTransfers: TokenTransfer[] = transfers.map(t => ({
    tokenId: Number(t.tokenId),
    from: String(t.from || ''),
    to: String(t.to || ''),
    blockNumber: Number(t.blockNumber || 0),
    transactionHash: String(t.transactionHash || ''),
    timestamp: t.timestamp instanceof Date ? t.timestamp : new Date(t.timestamp),
    value: String(t.value || '1'),
    tokenAddress: String(t.tokenAddress || tokenAddress).toLowerCase()
  }));
  
  return calculateNftOwnership(mappedTransfers);
}

/**
 * Paginate NFT items
 * 
 * @param items - Array of NFT items
 * @param page - Page number (1-indexed)
 * @param limit - Items per page
 * @returns Paginated items and metadata
 */
export function paginateNftItems(
  items: Array<{ tokenId: number; owner: string }>,
  page: number,
  limit: number
): {
  items: Array<{ tokenId: number; owner: string }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
} {
  const total = items.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const paginatedItems = items.slice(start, start + limit);
  
  return {
    items: paginatedItems,
    pagination: {
      page,
      limit,
      total,
      totalPages
    }
  };
}
