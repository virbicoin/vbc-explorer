import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/db';
import mongoose from 'mongoose';
import {
  escapeRegex,
  sanitizeSearchQuery,
  checkRateLimit,
  getClientIp,
} from '../../../lib/security/validation';

export const dynamic = 'force-dynamic';

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
  const { ERC: erc, type, symbol, decimals, contractName, name, tokenName } = doc;

  // If type is already set as a string (not 'Contract'), normalize and use it
  if (type && type !== 'Contract') {
    return normalizeTokenType(type);
  }

  // Convert ERC number to type string
  switch (erc) {
    case 2:
    case 20:
      return 'VRC-20';
    case 3:
    case 223:
      return 'VRC-223';
    case 721:
      return 'VRC-721';
    case 1155:
      return 'VRC-1155';
  }

  // Check if contract name contains NFT-related keywords first
  const fullName = `${contractName || ''} ${name || ''} ${tokenName || ''}`.toLowerCase();
  if (fullName.includes('nft') || fullName.includes('721')) {
    return 'VRC-721';
  }
  if (fullName.includes('1155')) {
    return 'VRC-1155';
  }

  // Infer token type from other fields if ERC is not set or is 0
  // If contract has symbol, it's likely a token
  if (symbol) {
    // If it has decimals defined, it's definitely an ERC20 token
    if (typeof decimals === 'number') {
      return 'VRC-20';
    }
    // If symbol exists but no decimals, check if it looks like a token name
    // Tokens typically have short symbols (2-10 chars)
    if (symbol.length >= 2 && symbol.length <= 10 && /^[A-Z0-9]+$/i.test(symbol)) {
      return 'VRC-20';
    }
  }

  // If tokenName is set, it's likely a token
  if (tokenName) {
    return 'VRC-20';
  }

  return 'Contract';
}

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimitResult = checkRateLimit(`contracts:${clientIp}`, 60, 1);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rateLimitResult.resetIn },
        { status: 429 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    // Validate and limit page number to prevent excessive skip operations
    const page = Math.min(Math.max(parseInt(searchParams.get('page') || '1', 10), 1), 1000);
    const limit = Math.min(parseInt(searchParams.get('limit') || '25', 10), 100);
    const verified = searchParams.get('verified');
    const type = searchParams.get('type');
    const search = searchParams.get('search');

    await dbConnect();
    const db = mongoose.connection.db;

    if (!db) {
      return NextResponse.json({ contracts: [], total: 0, page, limit });
    }

    // Build query - Contract collection contains all contracts
    // No need for isContract filter as all documents in Contract collection are contracts
    const query: Record<string, unknown> = {};

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
    const contracts = contractDocs.map((doc) => {
      const contractDoc = doc as unknown as ContractDocument;
      const contractType = getContractType(contractDoc);
      return {
        address: contractDoc.address,
        name:
          contractDoc.contractName ||
          contractDoc.tokenName ||
          contractDoc.name ||
          (contractType !== 'Contract' ? contractDoc.symbol : null) ||
          'Unknown Contract',
        symbol: contractDoc.symbol || null,
        type: contractType,
        verified: contractDoc.verified || false,
        blockNumber: contractDoc.blockNumber || null,
        compilerVersion: contractDoc.compilerVersion || null,
        createdAt: contractDoc.createdAt ? contractDoc.createdAt.toISOString() : null,
      };
    });

    return NextResponse.json({
      contracts,
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('Error fetching contracts:', error);
    return NextResponse.json(
      { contracts: [], total: 0, error: 'Failed to fetch contracts' },
      { status: 500 }
    );
  }
}
