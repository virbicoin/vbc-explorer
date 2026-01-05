import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/db';
import mongoose from 'mongoose';

export const dynamic = 'force-dynamic';

interface ContractDocument {
  address: string;
  contractName?: string;
  name?: string;
  symbol?: string;
  type?: string;
  verified?: boolean;
  blockNumber?: number;
  compilerVersion?: string;
  createdAt?: Date;
  isContract?: boolean;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
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
        query.type = { $nin: ['VRC-20', 'VRC-721', 'VRC-1155', 'ERC20', 'ERC721'] };
      } else {
        query.type = type;
      }
    }

    if (search) {
      const searchRegex = new RegExp(search, 'i');
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
      return {
        address: contractDoc.address,
        name: contractDoc.contractName || contractDoc.name || 'Unknown Contract',
        symbol: contractDoc.symbol || null,
        type: contractDoc.type || 'Contract',
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
