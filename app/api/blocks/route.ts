import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Block } from '../../../models/index';
import { apiCache, CACHE_TTL } from '../../../lib/cache';

interface BlockData {
  number: string;
  hash: string;
  miner: string;
  timestamp: string;
  transactions: string;
  gasUsed: string;
  gasLimit: string;
  difficulty: string;
  totalDifficulty: string;
  size: string;
  nonce: string;
  extraData: string;
  parentHash: string;
  stateRoot: string;
  receiptsRoot: string;
  transactionsRoot: string;
  logsBloom: string;
  sha3Uncles: string;
  uncles: string[];
}

interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  total: number;
  limit: number;
}

interface BlocksResponse {
  blocks: BlockData[];
  pagination: PaginationInfo;
}

// キャッシュ設定
interface CacheEntry {
  data: BlocksResponse;
  timestamp: number;
}

const blocksCache = new Map<string, CacheEntry>();
const CACHE_DURATION_PAGE1 = 10000; // ページ1: 10秒キャッシュ（リアルタイム性重視）
const CACHE_DURATION_OTHER = 300000; // その他: 5分キャッシュ

// バックグラウンド更新フラグ
const updateInProgress = new Set<string>();

async function fetchBlocksData(page: number, limit: number): Promise<BlocksResponse> {
  await connectDB();

  const skip = (page - 1) * limit;

  // ブロック総数を取得（推定カウントで高速化）
  const totalBlocks = await Block.estimatedDocumentCount();
  const totalPages = Math.ceil(totalBlocks / limit);

  // MongoDBからブロックを取得（インデックス済みで高速）
  const blocks = await Block.find({})
    .sort({ number: -1 })
    .skip(skip)
    .limit(limit)
    .select({
      number: 1,
      hash: 1,
      miner: 1,
      timestamp: 1,
      gasUsed: 1,
      gasLimit: 1,
      difficulty: 1,
      totalDifficulty: 1,
      size: 1,
      nonce: 1,
      extraData: 1,
      parentHash: 1,
      stateRoot: 1,
      transactionsRoot: 1,
      logsBloom: 1,
      sha3Uncles: 1,
      uncles: 1,
      _id: 0,
    })
    .lean()
    .maxTimeMS(30000);

  // ブロックデータを整形
  const formattedBlocks: BlockData[] = blocks.map((block: Record<string, unknown>) => ({
    number: String(block.number ?? '0'),
    hash: String(block.hash ?? ''),
    miner: String(block.miner ?? ''),
    timestamp: String(block.timestamp ?? '0'),
    transactions: '0',
    gasUsed: String(block.gasUsed ?? '0'),
    gasLimit: String(block.gasLimit ?? '0'),
    difficulty: String(block.difficulty ?? '0'),
    totalDifficulty: String(block.totalDifficulty ?? '0'),
    size: String(block.size ?? '0'),
    nonce: String(block.nonce ?? ''),
    extraData: String(block.extraData ?? ''),
    parentHash: String(block.parentHash ?? ''),
    stateRoot: String(block.stateRoot ?? ''),
    receiptsRoot: '',
    transactionsRoot: String(block.transactionsRoot ?? ''),
    logsBloom: String(block.logsBloom ?? ''),
    sha3Uncles: String(block.sha3Uncles ?? ''),
    uncles: Array.isArray(block.uncles) ? block.uncles.map((u: unknown) => String(u ?? '')) : [],
  }));

  return {
    blocks: formattedBlocks,
    pagination: {
      currentPage: page,
      totalPages,
      total: totalBlocks,
      limit,
    },
  };
}

// バックグラウンドでキャッシュを更新
async function updateCacheInBackground(cacheKey: string, page: number, limit: number) {
  if (updateInProgress.has(cacheKey)) return;
  updateInProgress.add(cacheKey);

  try {
    const data = await fetchBlocksData(page, limit);
    blocksCache.set(cacheKey, { data, timestamp: Date.now() });
  } catch (error) {
    console.error('[Blocks] Background update failed:', error);
  } finally {
    updateInProgress.delete(cacheKey);
  }
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '25'), 100);

    const cacheKey = `blocks_${page}_${limit}`;
    const now = Date.now();
    const cached = blocksCache.get(cacheKey);

    // ページ1はリアルタイム性重視で短いキャッシュ
    const cacheDuration = page === 1 ? CACHE_DURATION_PAGE1 : CACHE_DURATION_OTHER;

    // キャッシュが有効な場合は返す
    if (cached && now - cached.timestamp < cacheDuration) {
      console.log(`[Blocks] Cache hit (page: ${page}, age: ${now - cached.timestamp}ms)`);
      return NextResponse.json(cached.data, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      });
    }

    // ページ1の場合: キャッシュが古い場合は必ず新しいデータを取得
    // ページ2以降: 古いキャッシュを返しつつバックグラウンドで更新
    if (cached && page !== 1) {
      console.log(`[Blocks] Returning stale cache (page: ${page}), updating in background`);
      updateCacheInBackground(cacheKey, page, limit);
      return NextResponse.json(cached.data, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      });
    }

    // 初回リクエストまたはページ1の更新: タイムアウト付きで取得
    console.log(`[Blocks] Fetching fresh data (page: ${page})...`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Blocks fetch timeout')), 15000);
    });

    try {
      const data = await Promise.race([fetchBlocksData(page, limit), timeoutPromise]);

      blocksCache.set(cacheKey, { data, timestamp: now });
      console.log(`[Blocks] Request completed in ${Date.now() - startTime}ms`);
      return NextResponse.json(data, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        },
      });
    } catch (timeoutError) {
      console.log('[Blocks] Fetch timed out, returning cached or empty data');
      // タイムアウト時は古いキャッシュがあれば返す
      if (cached) {
        updateCacheInBackground(cacheKey, page, limit);
        return NextResponse.json(cached.data, {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            Pragma: 'no-cache',
          },
        });
      }
      updateCacheInBackground(cacheKey, page, limit);
      return NextResponse.json({
        blocks: [],
        pagination: { currentPage: page, totalPages: 0, total: 0, limit },
        loading: true,
      });
    }
  } catch (error) {
    console.error('Error fetching blocks:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch blocks',
        blocks: [],
        pagination: { currentPage: 1, totalPages: 0, total: 0, limit: 25 },
      },
      { status: 500 }
    );
  }
}
