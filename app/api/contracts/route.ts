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
}

// Helper function to convert ERC number to type string
function getContractType(erc?: number, type?: string): string {
  // If type is already set as a string, use it
  if (type && type !== 'Contract') {
    return type;
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
    default:
      return 'Contract';
  }
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
      const contractType = getContractType(contractDoc.ERC, contractDoc.type);
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
