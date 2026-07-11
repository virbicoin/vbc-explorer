import { NextRequest } from 'next/server';
import dbConnect from '../../../lib/db';
import { tryGetDb } from '../../../lib/db/get-db';
import {
  escapeRegex,
  sanitizeSearchQuery,
  checkRateLimit,
  getClientIp,
} from '../../../lib/security/validation';
import {
  paginatedResponse,
  rateLimitResponse,
  internalErrorResponse,
  ContractTypes,
  type ContractType,
} from '../../../lib/api-response';
import { readConfig } from '../../../lib/config';

export const dynamic = 'force-dynamic';

// Known tokens from config.json (address -> token info)
interface KnownToken {
  name: string;
  symbol: string;
  decimals: number;
  type: string;
}

// Get known tokens from config, cached
let knownTokensCache: Record<string, KnownToken> | null = null;
function getKnownTokens(): Record<string, KnownToken> {
  if (knownTokensCache) return knownTokensCache;
  try {
    const config = readConfig();
    const tokens = (config as any).knownTokens || {};
    // Normalize addresses to lowercase
    knownTokensCache = Object.entries(tokens).reduce(
      (acc, [addr, info]) => {
        acc[addr.toLowerCase()] = info as KnownToken;
        return acc;
      },
      {} as Record<string, KnownToken>
    );
    return knownTokensCache;
  } catch {
    return {};
  }
}

// Contracts blacklisted in config.json (blacklist.contracts) are hidden from
// the listing — e.g. deprecated or broken deployments users must not interact
// with. Their address pages stay reachable directly (on-chain data is public).
let blacklistedContractsCache: string[] | null = null;
function getBlacklistedContracts(): string[] {
  if (blacklistedContractsCache) return blacklistedContractsCache;
  try {
    const config = readConfig();
    const list = ((config as any).blacklist?.contracts as { address?: string }[] | undefined) || [];
    blacklistedContractsCache = list
      .map((c) => (c.address || '').toLowerCase())
      .filter((a) => /^0x[0-9a-f]{40}$/.test(a));
    return blacklistedContractsCache;
  } catch {
    return [];
  }
}

interface ContractDocument {
  address: string;
  contractName?: string;
  tokenName?: string;
  name?: string;
  symbol?: string;
  type?: string;
  ERC?: number; // 0:normal contract, 2:ERC20, 3:ERC223, 721:VRC-721, 1155:VRC-1155
  verified?: boolean;
  blockNumber?: number;
  compilerVersion?: string;
  createdAt?: Date;
  isContract?: boolean;
  decimals?: number;
}

// Normalize token type string to consistent VRC-XX format
function normalizeTokenType(type: string): string {
  const normalized = type.toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Map various formats to consistent VRC-XX format
  if (normalized === 'ERC20' || normalized === 'VRC20' || normalized === 'TOKEN') {
    return 'VRC-20';
  }
  if (normalized === 'ERC223' || normalized === 'VRC223') {
    return 'VRC-223';
  }
  if (normalized === 'ERC721' || normalized === 'VRC721' || normalized === 'NFT') {
    return 'VRC-721';
  }
  if (normalized === 'ERC1155' || normalized === 'VRC1155') {
    return 'VRC-1155';
  }

  // Return original if already in correct format or unknown
  if (type.startsWith('VRC-')) {
    return type;
  }

  return 'Contract';
}

// Helper function to convert ERC number to type string
// Also infers token type from other fields when ERC is not set
function getContractType(doc: ContractDocument): string {
  const { address, ERC: erc, type, symbol, decimals, contractName, name, tokenName } = doc;

  // First, check if this contract is in knownTokens config
  const knownTokens = getKnownTokens();
  const knownToken = address ? knownTokens[address.toLowerCase()] : null;
  if (knownToken?.type) {
    return normalizeTokenType(knownToken.type);
  }

  // If type is already set as a string (not 'Contract'), normalize and use it
  if (type && type !== 'Contract') {
    return normalizeTokenType(type);
  }

  // Check if contract name contains NFT-related keywords FIRST
  // This takes priority over ERC field since some NFTs are incorrectly marked as ERC20
  const fullName =
    `${contractName || ''} ${name || ''} ${tokenName || ''} ${symbol || ''}`.toLowerCase();
  if (
    fullName.includes('nft') ||
    fullName.includes('721') ||
    fullName.includes('erc721') ||
    fullName.includes('vrc721')
  ) {
    return ContractTypes.VRC721;
  }
  if (fullName.includes('1155') || fullName.includes('erc1155') || fullName.includes('vrc1155')) {
    return ContractTypes.VRC1155;
  }

  // Convert ERC number to type string
  switch (erc) {
    case 2:
    case 20:
      return ContractTypes.VRC20;
    case 3:
    case 223:
      return ContractTypes.VRC223;
    case 721:
      return ContractTypes.VRC721;
    case 1155:
      return ContractTypes.VRC1155;
  }

  // Infer token type from other fields if ERC is not set or is 0
  // If contract has symbol, it's likely a token
  if (symbol) {
    // If it has decimals defined, it's definitely an ERC20 token
    if (typeof decimals === 'number') {
      return ContractTypes.VRC20;
    }
    // If symbol exists but no decimals, check if it looks like a token name
    // Tokens typically have short symbols (2-10 chars)
    if (symbol.length >= 2 && symbol.length <= 10 && /^[A-Z0-9]+$/i.test(symbol)) {
      return ContractTypes.VRC20;
    }
  }

  // If tokenName is set, it's likely a token
  if (tokenName) {
    return ContractTypes.VRC20;
  }

  return ContractTypes.CONTRACT;
}

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimitResult = checkRateLimit(`contracts:${clientIp}`, 60, 1);
    if (!rateLimitResult.allowed) {
      return rateLimitResponse(rateLimitResult.resetIn);
    }

    const searchParams = request.nextUrl.searchParams;
    // Validate and limit page number to prevent excessive skip operations
    const page = Math.min(Math.max(parseInt(searchParams.get('page') || '1', 10), 1), 1000);
    const limit = Math.min(parseInt(searchParams.get('limit') || '25', 10), 100);
    const verified = searchParams.get('verified');
    const type = searchParams.get('type');
    const search = searchParams.get('search');

    await dbConnect();
    const db = tryGetDb();

    if (!db) {
      return paginatedResponse([], { page, limit, total: 0 });
    }

    // Build query - Contract collection contains all contracts
    // No need for isContract filter as all documents in Contract collection are contracts
    const query: Record<string, unknown> = {};

    // Hide blacklisted contracts (deprecated/broken deployments) from the list
    const blacklistedContracts = getBlacklistedContracts();
    if (blacklistedContracts.length > 0) {
      query.address = { $nin: blacklistedContracts };
    }

    if (verified === 'true') {
      query.verified = true;
    } else if (verified === 'false') {
      query.verified = { $ne: true };
    }

    if (type && type !== 'all') {
      if (type === 'Contract') {
        // Filter for normal contracts only (ERC = 0 or null, and no token type)
        query.$and = [
          { $or: [{ ERC: { $in: [0, null] } }, { ERC: { $exists: false } }] },
          { $or: [{ type: { $in: ['Contract', null] } }, { type: { $exists: false } }] },
        ];
      } else if (type === 'VRC-20') {
        query.$or = [{ type: 'VRC-20' }, { ERC: { $in: [2, 20] } }];
      } else if (type === 'VRC-721') {
        query.$or = [{ type: 'VRC-721' }, { ERC: 721 }];
      } else if (type === 'VRC-1155') {
        query.$or = [{ type: 'VRC-1155' }, { ERC: 1155 }];
      } else {
        query.type = type;
      }
    }

    if (search) {
      // Sanitize and escape search query to prevent ReDoS attacks
      const sanitized = sanitizeSearchQuery(search, 100);
      const escaped = escapeRegex(sanitized);
      const searchRegex = new RegExp(escaped, 'i');
      query.$or = [
        { address: searchRegex },
        { contractName: searchRegex },
        { name: searchRegex },
        { symbol: searchRegex },
      ];
    }

    // Get total count - use 'Contract' collection (capital C)
    const total = await db.collection('Contract').countDocuments(query);

    // Get contracts with pagination
    const skip = (page - 1) * limit;
    const contractDocs = await db
      .collection('Contract')
      .find(query)
      .sort({ blockNumber: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Format contracts
    const knownTokens = getKnownTokens();
    const contracts = contractDocs.map((doc) => {
      const contractDoc = doc as unknown as ContractDocument;
      const contractType = getContractType(contractDoc);

      // Get known token info if available
      const knownToken = contractDoc.address
        ? knownTokens[contractDoc.address.toLowerCase()]
        : null;

      return {
        address: contractDoc.address,
        name:
          knownToken?.name ||
          contractDoc.contractName ||
          contractDoc.tokenName ||
          contractDoc.name ||
          (contractType !== ContractTypes.CONTRACT ? contractDoc.symbol : null) ||
          'Unknown Contract',
        symbol: knownToken?.symbol || contractDoc.symbol || null,
        type: contractType,
        verified: contractDoc.verified || false,
        blockNumber: contractDoc.blockNumber || null,
        compilerVersion: contractDoc.compilerVersion || null,
        createdAt: contractDoc.createdAt ? contractDoc.createdAt.toISOString() : null,
      };
    });

    return paginatedResponse(contracts, { page, limit, total });
  } catch (error) {
    console.error('Error fetching contracts:', error);
    return internalErrorResponse('Failed to fetch contracts');
  }
}
