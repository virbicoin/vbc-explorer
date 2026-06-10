import { NextResponse } from 'next/server';
import { connectDB, Block, Transaction } from '../../../models/index';

/**
 * Lightweight API endpoint for real-time updates
 * Used for the Latest Block and Latest Blocks/Transactions on the home page
 * Uses a short cache duration and minimal payload for fast responses
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

// Lightweight cache (10 seconds)
let realtimeCache: RealtimeData | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 10000; // 10-second cache

// Background update flag
let isUpdating = false;

async function fetchRealtimeData(): Promise<RealtimeData> {
  await connectDB();

  // Fetch the latest 10 blocks and 10 transactions in parallel
  const [blocksResult, transactionsResult] = await Promise.allSettled([
    Block.find({})
      .sort({ number: -1 })
      .limit(10)
      .select({ number: 1, hash: 1, timestamp: 1, miner: 1, _id: 0 })
      .lean()
      .maxTimeMS(5000), // 5-second timeout
    Transaction.find({})
      .sort({ blockNumber: -1, transactionIndex: -1 })
      .limit(10)
      .select({ hash: 1, from: 1, to: 1, value: 1, timestamp: 1, _id: 0 })
      .lean()
      .maxTimeMS(5000), // 5-second timeout
  ]);

  const blocks =
    blocksResult.status === 'fulfilled'
      ? (blocksResult.value as Array<{
          number: number;
          hash: string;
          timestamp: number;
          miner: string;
        }>)
      : [];

  const transactions =
    transactionsResult.status === 'fulfilled'
      ? (transactionsResult.value as Array<{
          hash: string;
          from: string;
          to: string;
          value: string;
          timestamp: number;
        }>)
      : [];

  return {
    latestBlock: blocks[0]?.number || 0,
    blocks: blocks.map((b) => ({
      number: b.number,
      hash: b.hash,
      timestamp: b.timestamp,
      miner: b.miner,
    })),
    transactions: transactions.map((tx) => ({
      hash: tx.hash,
      from: tx.from,
      to: tx.to || '',
      value: tx.value,
      timestamp: tx.timestamp,
    })),
    timestamp: Date.now(),
  };
}

// Update cache in the background
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
    // Return immediately if the cache is still valid
    if (realtimeCache && now - cacheTimestamp < CACHE_DURATION) {
      return NextResponse.json(realtimeCache, {
        headers: {
          'Cache-Control': 'public, max-age=5, stale-while-revalidate=10',
        },
      });
    }

    // Cache is stale but exists: return stale data while updating in the background
    if (realtimeCache) {
      updateCacheInBackground();
      return NextResponse.json(realtimeCache, {
        headers: {
          'Cache-Control': 'public, max-age=5, stale-while-revalidate=10',
        },
      });
    }

    // First request: fetch with a 5-second timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Realtime fetch timeout')), 5000);
    });

    try {
      const data = await Promise.race([fetchRealtimeData(), timeoutPromise]);

      realtimeCache = data;
      cacheTimestamp = now;

      return NextResponse.json(data, {
        headers: {
          'Cache-Control': 'public, max-age=5, stale-while-revalidate=10',
        },
      });
    } catch {
      // On timeout, return empty data while updating in the background
      updateCacheInBackground();
      return NextResponse.json({
        latestBlock: 0,
        blocks: [],
        transactions: [],
        timestamp: now,
        loading: true,
      });
    }
  } catch (error) {
    console.error('[Realtime] API error:', error);
    return NextResponse.json(
      {
        latestBlock: 0,
        blocks: [],
        transactions: [],
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'API error',
      },
      { status: 500 }
    );
  }
}
