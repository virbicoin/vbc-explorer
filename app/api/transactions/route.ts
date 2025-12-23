import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { weiToVBC } from '../../../lib/bigint-utils';
import { connectDB } from '../../../models/index';
import { getTransactionTypeGlobal, TransactionTypeResult } from '../../../lib/transaction-utils';

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
  type: string;
  action: string;
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
  loading?: boolean;
}

const transactionsCache = new Map<string, CacheEntry>();
const CACHE_DURATION = 300000; // 5分キャッシュ (for t4g.small)

// バックグラウンド更新フラグ
const updateInProgress = new Set<string>();

async function fetchTransactionsData(page: number, limit: number, hasPageParams: boolean): Promise<TransactionResponse[] | PaginatedResponse> {
  await connectDB();
  const db = mongoose.connection.db;
  const skip = (page - 1) * limit;

  let totalCount = 0;
  let totalPages = 0;
  
  if (hasPageParams) {
    const stats = await db?.collection('Transaction').estimatedDocumentCount();
    totalCount = stats || 0;
    totalPages = Math.ceil(totalCount / limit);
  }

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
      input: 1,
      _id: 0
    })
    .maxTimeMS(30000)
    .toArray();

   
  const formattedTransactions = (transactions || []).map((tx: any) => {
    const typeInfo = getTransactionTypeGlobal({
      from: tx.from,
      to: tx.to,
      value: tx.value || '0',
      input: tx.input,
      status: tx.status
    });
    
    return {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value ? weiToVBC(tx.value) : '0',
      timestamp: tx.timestamp,
      blockNumber: tx.blockNumber,
      gasUsed: tx.gasUsed,
      gasPrice: tx.gasPrice,
      status: tx.status,
      type: typeInfo.type,
      action: typeInfo.action
    };
  });

  if (hasPageParams) {
    return {
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
  }
  return formattedTransactions;
}

// バックグラウンドでキャッシュを更新
async function updateCacheInBackground(cacheKey: string, page: number, limit: number, hasPageParams: boolean) {
  if (updateInProgress.has(cacheKey)) return;
  updateInProgress.add(cacheKey);
  
  try {
    const data = await fetchTransactionsData(page, limit, hasPageParams);
    transactionsCache.set(cacheKey, { data, timestamp: Date.now() });
  } catch (error) {
    console.error('[Transactions] Background update failed:', error);
  } finally {
    updateInProgress.delete(cacheKey);
  }
}

export async function GET(request: Request) {
  const startTime = Date.now();
  
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '15'), 100);
    const hasPageParams = searchParams.has('page') || searchParams.has('limit');
    
    const cacheKey = `tx_${page}_${limit}`;
    const now = Date.now();
    const cached = transactionsCache.get(cacheKey);
    
    // キャッシュが有効な場合は返す
    if (cached && now - cached.timestamp < CACHE_DURATION) {
      console.log(`[Transactions] Cache hit (age: ${now - cached.timestamp}ms)`);
      return NextResponse.json(cached.data);
    }
    
    // キャッシュが古いが存在する場合: 古いデータを返しつつバックグラウンドで更新
    if (cached) {
      console.log('[Transactions] Returning stale cache, updating in background');
      updateCacheInBackground(cacheKey, page, limit, hasPageParams);
      return NextResponse.json(cached.data);
    }

    // 初回リクエスト: タイムアウト付きで取得
    console.log('[Transactions] First request, fetching with timeout...');
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Transactions fetch timeout')), 15000);
    });
    
    try {
      const data = await Promise.race([
        fetchTransactionsData(page, limit, hasPageParams),
        timeoutPromise
      ]);
      
      transactionsCache.set(cacheKey, { data, timestamp: now });
      console.log(`[Transactions] Request completed in ${Date.now() - startTime}ms`);
      return NextResponse.json(data);
      
    } catch (timeoutError) {
      console.log('[Transactions] Initial fetch timed out, returning empty data');
      updateCacheInBackground(cacheKey, page, limit, hasPageParams);
      
      if (hasPageParams) {
        return NextResponse.json({
          transactions: [],
          pagination: { page, limit, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
          loading: true
        });
      }
      return NextResponse.json([]);
    }

  } catch (error) {
    console.error('Transactions API error:', error);
    return NextResponse.json([], { status: 200 });
  }
}