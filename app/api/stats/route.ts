import { NextResponse } from 'next/server';
import { getChainStats } from '../../../lib/stats';
import { connectDB, Block } from '../../../models/index';

import { getGasUnitServer } from '../../../lib/config';

// 統計データのキャッシュ
interface StatsCacheData {
  basic: Record<string, unknown>;
  enhanced: Record<string, unknown>;
}

interface StatsCache {
  data: StatsCacheData;
  timestamp: number;
}

let statsCache: StatsCache | null = null;
const STATS_CACHE_DURATION = 300000; // 5分キャッシュ (for t4g.small)

// デフォルトの統計データ（初期ロード用）
function getDefaultStats(gasUnit: string) {
  return {
    basic: {
      latestBlock: 0,
      avgBlockTime: '0',
      networkHashrate: '0',
      networkDifficulty: '0',
      isConnected: false,
      totalTransactions: 0,
      avgTransactionFee: '0',
      lastBlockTime: null,
      lastBlockTimestamp: null
    },
    enhanced: {
      latestBlock: 0,
      avgBlockTime: '0',
      networkHashrate: '0',
      networkDifficulty: '0',
      isConnected: false,
      totalTransactions: 0,
      avgGasPrice: '0',
      avgTransactionFee: `0 ${gasUnit}`,
      activeMiners: 0,
      lastBlockTime: null,
      lastBlockTimestamp: null,
      loading: true // フロントエンドで再フェッチするフラグ
    }
  };
}

// バックグラウンドでキャッシュを更新
let isUpdating = false;
async function updateCacheInBackground() {
  if (isUpdating) return;
  isUpdating = true;
  
  try {
    console.log('[Stats] Background cache update starting...');
    const stats = await getChainStats();
    
    let activeMiners = 0;
    try {
      await connectDB();
      const recentBlocks = await Block.find({})
        .sort({ number: -1 })
        .limit(50) // Reduced from 100
        .select('miner')
        .lean()
        .maxTimeMS(30000);
      
      const uniqueMiners = new Set<string>();
      recentBlocks.forEach((block: { miner?: string }) => {
        if (block.miner) {
          uniqueMiners.add(block.miner.toLowerCase());
        }
      });
      activeMiners = uniqueMiners.size;
    } catch (error) {
      console.error('[Stats] Error calculating active miners:', error);
    }
    
    const gasUnit = getGasUnitServer();
    const enhancedStats = {
      latestBlock: stats.latestBlock,
      avgBlockTime: stats.avgBlockTime,
      networkHashrate: stats.networkHashrate,
      networkDifficulty: stats.networkDifficulty,
      isConnected: stats.isConnected,
      totalTransactions: stats.totalTransactions,
      avgGasPrice: stats.avgTransactionFee,
      avgTransactionFee: `${stats.avgTransactionFee} ${gasUnit}`,
      activeMiners: activeMiners,
      lastBlockTime: stats.lastBlockTime,
      lastBlockTimestamp: stats.lastBlockTimestamp
    };
    
    statsCache = {
      data: { basic: stats, enhanced: enhancedStats },
      timestamp: Date.now()
    };
    console.log('[Stats] Background cache update completed');
  } catch (error) {
    console.error('[Stats] Background cache update failed:', error);
  } finally {
    isUpdating = false;
  }
}

export async function GET(request: Request) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const enhanced = searchParams.get('enhanced') === 'true';
  const gasUnit = getGasUnitServer();
  
  try {
    const now = Date.now();
    
    // キャッシュが有効な場合はキャッシュを返す
    if (statsCache && now - statsCache.timestamp < STATS_CACHE_DURATION) {
      console.log(`[Stats] Returning cached data (age: ${now - statsCache.timestamp}ms)`);
      if (!enhanced) {
        return NextResponse.json(statsCache.data.basic);
      }
      return NextResponse.json(statsCache.data.enhanced);
    }
    
    // キャッシュが古いが存在する場合: 古いデータを返しつつバックグラウンドで更新
    if (statsCache) {
      console.log('[Stats] Returning stale cache, updating in background');
      updateCacheInBackground();
      if (!enhanced) {
        return NextResponse.json(statsCache.data.basic);
      }
      return NextResponse.json(statsCache.data.enhanced);
    }
    
    // 初回リクエスト: 同期的にデータを取得（タイムアウト付き）
    console.log('[Stats] First request, fetching data with timeout...');
    
    // 15秒タイムアウトで取得を試みる
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Stats fetch timeout')), 15000);
    });
    
    try {
      const stats = await Promise.race([
        getChainStats(),
        timeoutPromise
      ]);
      
      console.log('[Stats] Stats fetched successfully:', { latestBlock: stats.latestBlock });
      
      // activeMinersは後で計算（バックグラウンドで）
      const enhancedStats = {
        latestBlock: stats.latestBlock,
        avgBlockTime: stats.avgBlockTime,
        networkHashrate: stats.networkHashrate,
        networkDifficulty: stats.networkDifficulty,
        isConnected: stats.isConnected,
        totalTransactions: stats.totalTransactions,
        avgGasPrice: stats.avgTransactionFee,
        avgTransactionFee: `${stats.avgTransactionFee} ${gasUnit}`,
        activeMiners: 0, // 初回は0、バックグラウンドで更新
        lastBlockTime: stats.lastBlockTime,
        lastBlockTimestamp: stats.lastBlockTimestamp
      };
      
      statsCache = {
        data: { basic: stats, enhanced: enhancedStats },
        timestamp: Date.now()
      };
      
      // バックグラウンドでactiveMinersを更新
      updateCacheInBackground();
      
      console.log(`[Stats] Request completed in ${Date.now() - startTime}ms`);
      if (!enhanced) {
        return NextResponse.json(stats);
      }
      return NextResponse.json(enhancedStats);
      
    } catch (timeoutError) {
      console.log('[Stats] Initial fetch timed out, returning default data');
      // タイムアウト時はデフォルトデータを返しつつ、バックグラウンドで更新
      updateCacheInBackground();
      const defaultStats = getDefaultStats(gasUnit);
      return NextResponse.json(enhanced ? defaultStats.enhanced : defaultStats.basic);
    }
    
  } catch (error) {
    console.error('[Stats] API error:', error);
    const defaultStats = getDefaultStats(gasUnit);
    return NextResponse.json(
      enhanced ? { ...defaultStats.enhanced, error: error instanceof Error ? error.message : 'API error' }
               : { ...defaultStats.basic, error: error instanceof Error ? error.message : 'API error' },
      { status: 500 }
    );
  }
}