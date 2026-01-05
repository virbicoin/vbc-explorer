import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Block, Transaction } from '@/models/index';
import {
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
  validatePagination,
} from '@/lib/security';

// Blockscout API v2 - Get blocks list
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`blocks:${clientIp}`, 100, 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: 'Rate limit exceeded' },
        { status: 429, headers: getSecurityHeaders() }
      );
    }

    await connectDB();

    // Pagination
    const pagination = validatePagination(
      searchParams.get('page'),
      searchParams.get('limit'),
      50
    );
    const skip = (pagination.page - 1) * pagination.limit;

    // Type filter
    const type = searchParams.get('type'); // block or uncle

    // Get blocks
    const blocks = await Block.find({})
      .sort({ number: -1 })
      .skip(skip)
      .limit(pagination.limit)
      .lean();

    // Get transaction counts for each block
    const blockNumbers = blocks.map((b) => b.number);
    const txCounts = await Transaction.aggregate([
      { $match: { blockNumber: { $in: blockNumbers } } },
      { $group: { _id: '$blockNumber', count: { $sum: 1 } } },
    ]);
    const txCountMap = new Map(txCounts.map((t) => [t._id, t.count]));

    // Format response in Blockscout v2 format
    const items = blocks.map((block: Record<string, unknown>) => ({
      height: block.number,
      hash: block.hash,
      timestamp: block.timestamp
        ? new Date((block.timestamp as number) * 1000).toISOString()
        : null,
      parent_hash: block.parentHash,
      miner: {
        hash: block.miner,
        is_contract: false,
        is_verified: false,
        name: null,
        ens_domain_name: null,
        implementation_name: null,
      },
      size: block.size,
      gas_used: block.gasUsed?.toString() || '0',
      gas_limit: block.gasLimit?.toString() || '0',
      gas_used_percentage: block.gasLimit
        ? (((block.gasUsed as number) / (block.gasLimit as number)) * 100).toFixed(2)
        : '0',
      difficulty: block.difficulty?.toString() || '0',
      total_difficulty: block.totalDifficulty?.toString() || '0',
      nonce: block.nonce || '0x0',
      extra_data: block.extraData || '0x',
      state_root: block.stateRoot,
      transactions_root: block.transactionsRoot,
      receipts_root: block.receiptRoot,
      sha3_uncles: block.sha3Uncles,
      uncles_hashes: block.uncles || [],
      tx_count: txCountMap.get(block.number as number) || 0,
      tx_fees: '0',
      burnt_fees: null,
      burnt_fees_percentage: null,
      priority_fee: null,
      base_fee_per_gas: null,
      rewards: [],
      type: 'block',
      withdrawals_count: 0,
      blob_gas_used: null,
      excess_blob_gas: null,
      blob_gas_price: null,
      burnt_blob_fees: null,
    }));

    // Get next page info
    const totalCount = await Block.countDocuments({});
    const hasNextPage = skip + blocks.length < totalCount;

    const response = {
      items,
      next_page_params: hasNextPage
        ? {
            block_number: blocks[blocks.length - 1]?.number,
            items_count: pagination.limit,
          }
        : null,
    };

    return NextResponse.json(response, { headers: getSecurityHeaders() });
  } catch (error) {
    console.error('Error fetching blocks:', error);
    return NextResponse.json(
      {
        message: 'Internal server error',
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}
