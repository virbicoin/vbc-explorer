import { NextResponse } from 'next/server';
import { connectDB, Block, Transaction } from '../../../models/index';

/**
 * リアルタイム更新用の軽量APIエンドポイント
 * トップページの Latest Block と Latest Blocks/Transactions 用
 * キャッシュ期間を短く、データ量を最小限にして高速レスポンスを実現
 */

interface RealtimeData {
  latestBlock: number;
  blocks: Array<{
    number: number;
    hash: string;
    timestamp: number;
    miner: string;
  }>;
  transactions: Array<{
    hash: string;
    from: string;
    to: string;
    value: string;
    timestamp: number;
  }>;
  timestamp: number;
}

// 軽量キャッシュ（10秒）
let realtimeCache: RealtimeData | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 10000; // 10秒キャッシュ

// バックグラウンド更新フラグ
let isUpdating = false;

async function fetchRealtimeData(): Promise<RealtimeData> {
  await connectDB();
  
  // 最新10ブロックと最新10トランザクションを並列取得
  const [blocksResult, transactionsResult] = await Promise.allSettled([
    Block.find({})
      .sort({ number: -1 })
      .limit(10)
      .select({ number: 1, hash: 1, timestamp: 1, miner: 1, _id: 0 })
      .lean()
      .maxTimeMS(5000), // 5秒タイムアウト
    Transaction.find({})
      .sort({ blockNumber: -1, transactionIndex: -1 })
      .limit(10)
      .select({ hash: 1, from: 1, to: 1, value: 1, timestamp: 1, _id: 0 })
      .lean()
      .maxTimeMS(5000) // 5秒タイムアウト
  ]);
  
  const blocks = blocksResult.status === 'fulfilled' 
    ? (blocksResult.value as Array<{ number: number; hash: string; timestamp: number; miner: string }>)
    : [];
  
  const transactions = transactionsResult.status === 'fulfilled'
    ? (transactionsResult.value as Array<{ hash: string; from: string; to: string; value: string; timestamp: number }>)
    : [];
  
  return {
    latestBlock: blocks[0]?.number || 0,
    blocks: blocks.map(b => ({
      number: b.number,
      hash: b.hash,
      timestamp: b.timestamp,
      miner: b.miner
    })),
    transactions: transactions.map(tx => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to || '',
      value: tx.value,
      timestamp: tx.timestamp
    })),
    timestamp: Date.now()
  };
}

// バックグラウンドでキャッシュを更新
async function updateCacheInBackground() {
  if (isUpdating) return;
  isUpdating = true;
  
  try {
    const data = await fetchRealtimeData();
    realtimeCache = data;
    cacheTimestamp = Date.now();
  } catch (error) {
    console.error('[Realtime] Background update failed:', error);
  } finally {
    isUpdating = false;
  }
}

export async function GET() {
  const now = Date.now();
  
  try {
    // キャッシュが有効な場合は即座に返す
    if (realtimeCache && now - cacheTimestamp < CACHE_DURATION) {
      return NextResponse.json(realtimeCache, {
        headers: {
          'Cache-Control': 'public, max-age=5, stale-while-revalidate=10'
        }
      });
    }
    
    // キャッシュが古いが存在する場合: 古いデータを返しつつバックグラウンドで更新
    if (realtimeCache) {
      updateCacheInBackground();
      return NextResponse.json(realtimeCache, {
        headers: {
          'Cache-Control': 'public, max-age=5, stale-while-revalidate=10'
        }
      });
    }
    
    // 初回リクエスト: 5秒タイムアウトで取得
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Realtime fetch timeout')), 5000);
    });
    
    try {
      const data = await Promise.race([
        fetchRealtimeData(),
        timeoutPromise
      ]);
      
      realtimeCache = data;
      cacheTimestamp = now;
      
      return NextResponse.json(data, {
        headers: {
          'Cache-Control': 'public, max-age=5, stale-while-revalidate=10'
        }
      });
      
    } catch {
      // タイムアウト時は空データを返しつつ、バックグラウンドで更新
      updateCacheInBackground();
      return NextResponse.json({
        latestBlock: 0,
        blocks: [],
        transactions: [],
        timestamp: now,
        loading: true
      });
    }
    
  } catch (error) {
    console.error('[Realtime] API error:', error);
    return NextResponse.json({
      latestBlock: 0,
      blocks: [],
      transactions: [],
      timestamp: Date.now(),
      error: error instanceof Error ? error.message : 'API error'
    }, { status: 500 });
  }
}
