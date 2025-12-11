import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { weiToVBC } from '../../../lib/bigint-utils';
import { connectDB } from '../../../models/index';

// トランザクションキャッシュ
interface CacheEntry {
  data: TransactionResponse[] | PaginatedResponse;
  timestamp: number;
}

interface TransactionResponse {
  hash: string;
  from: string;
  to: string;
  value: string;
  timestamp: number;
  blockNumber: number;
  gasUsed: number;
  gasPrice: string;
  status: number;
}

interface PaginatedResponse {
  transactions: TransactionResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

const transactionsCache = new Map<string, CacheEntry>();
const CACHE_DURATION = 30000; // 30秒キャッシュ (extended for low-spec servers)

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '15'), 100);
    const skip = (page - 1) * limit;
    
    // キャッシュキー
    const cacheKey = `tx_${page}_${limit}`;
    const now = Date.now();
    const cached = transactionsCache.get(cacheKey);
    
    // キャッシュが有効な場合は返す
    if (cached && now - cached.timestamp < CACHE_DURATION) {
      return NextResponse.json(cached.data);
    }

    await connectDB();

    const db = mongoose.connection.db;

    // Only get total count when explicitly requested for pagination
    let totalCount = 0;
    let totalPages = 0;
    
    const hasPageParams = searchParams.has('page') || searchParams.has('limit');
    if (hasPageParams) {
      // Use estimated count for better performance with large collections
      const stats = await db?.collection('Transaction').estimatedDocumentCount();
      totalCount = stats || 0;
      totalPages = Math.ceil(totalCount / limit);
    }

    // Ensure basic indexes exist for performance (only create if not exists)
    try {
      const indexes = await db?.collection('Transaction').indexes();
      const hasBlockNumberIndex = indexes?.some((idx) => {
        const key = idx.key as Record<string, number>;
        return key.blockNumber === -1 || (key.blockNumber === -1 && key.transactionIndex === -1);
      });
      
      if (!hasBlockNumberIndex) {
        console.log('Creating missing Transaction indexes...');
        await db?.collection('Transaction').createIndex({ blockNumber: -1 }, { background: true });
        await db?.collection('Transaction').createIndex({ blockNumber: -1, transactionIndex: -1 }, { background: true });
        console.log('Transaction indexes created successfully');
      }
    } catch (indexError) {
      // Indexes may already exist or creation failed, continue anyway
      console.log('Index setup info:', indexError instanceof Error ? indexError.message : indexError);
    }

    // Optimized query - let MongoDB choose the best index automatically
    const transactions = await db?.collection('Transaction')
      .find({})
      .sort({ blockNumber: -1, transactionIndex: -1 })
      .skip(skip)
      .limit(limit)
      .project({
        hash: 1,
        from: 1,
        to: 1,
        value: 1,
        timestamp: 1,
        blockNumber: 1,
        gasUsed: 1,
        gasPrice: 1,
        status: 1,
        _id: 0 // Exclude _id for smaller payload
      })
      .maxTimeMS(30000)
      .toArray();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formattedTransactions = (transactions || []).map((tx: any) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value ? weiToVBC(tx.value) : '0',
      timestamp: tx.timestamp,
      blockNumber: tx.blockNumber,
      gasUsed: tx.gasUsed,
      gasPrice: tx.gasPrice,
      status: tx.status
    }));

    let responseData: TransactionResponse[] | PaginatedResponse;
    
    if (hasPageParams) {
      responseData = {
        transactions: formattedTransactions,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };
    } else {
      // For homepage requests (without pagination), return optimized array format
      responseData = formattedTransactions;
    }
    
    // キャッシュに保存
    transactionsCache.set(cacheKey, { data: responseData, timestamp: now });
    
    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Transactions API error:', error);
    return NextResponse.json([], { status: 200 }); // エラー時も空配列を返す
  }
}