import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Block, Transaction } from '@/models/index';
import { checkRateLimit, getClientIp, getSecurityHeaders } from '@/lib/security';

// Blockscout API v2 - Get block by number or hash
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ numberOrHash: string }> }
) {
  try {
    const { numberOrHash } = await params;

    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`block:${clientIp}`, 100, 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: 'Rate limit exceeded' },
        { status: 429, headers: getSecurityHeaders() }
      );
    }

    await connectDB();

    // Determine if it's a block number or hash
    let query: { number?: number; hash?: string } = {};
    if (numberOrHash.startsWith('0x')) {
      query.hash = numberOrHash.toLowerCase();
    } else {
      const blockNumber = parseInt(numberOrHash);
      if (isNaN(blockNumber) || blockNumber < 0) {
        return NextResponse.json(
          { message: 'Invalid block number' },
          { status: 400, headers: getSecurityHeaders() }
        );
      }
      query.number = blockNumber;
    }

    // Get block
    const block = await Block.findOne(query).lean();

    if (!block) {
      return NextResponse.json(
        { message: 'Block not found' },
        { status: 404, headers: getSecurityHeaders() }
      );
    }

    // Get transaction count
    const txCount = await Transaction.countDocuments({ blockNumber: block.number });

    // Format response in Blockscout v2 format
    const response = {
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
      tx_count: txCount,
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
    };

    return NextResponse.json(response, { headers: getSecurityHeaders() });
  } catch (error) {
    console.error('Error fetching block:', error);
    return NextResponse.json(
      {
        message: 'Internal server error',
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}
