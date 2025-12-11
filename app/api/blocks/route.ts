import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Block } from '../../../models/index';

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
const CACHE_DURATION = 30000; // 30秒キャッシュ (extended for low-spec servers)

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '25'), 100); // 最大100に制限

    // キャッシュキー
    const cacheKey = `blocks_${page}_${limit}`;
    const now = Date.now();
    const cached = blocksCache.get(cacheKey);
    
    // キャッシュが有効な場合は返す
    if (cached && now - cached.timestamp < CACHE_DURATION) {
      return NextResponse.json(cached.data);
    }

    // MongoDBに接続
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
        _id: 0
      })
      .lean()
      .maxTimeMS(30000);

    // ブロックデータを整形
     
    const formattedBlocks: BlockData[] = blocks.map((block: Record<string, unknown>) => ({
      number: String(block.number ?? '0'),
      hash: String(block.hash ?? ''),
      miner: String(block.miner ?? ''),
      timestamp: String(block.timestamp ?? '0'),
      transactions: '0', // トランザクション数は後で必要に応じて取得
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
      uncles: Array.isArray(block.uncles) ? block.uncles.map((u: unknown) => String(u ?? '')) : []
    }));

    const pagination: PaginationInfo = {
      currentPage: page,
      totalPages,
      total: totalBlocks,
      limit
    };

    const response: BlocksResponse = {
      blocks: formattedBlocks,
      pagination
    };

    // キャッシュに保存
    blocksCache.set(cacheKey, { data: response, timestamp: now });

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching blocks:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch blocks',
        blocks: [],
        pagination: { currentPage: 1, totalPages: 0, total: 0, limit: 25 }
      },
      { status: 500 }
    );
  }
}