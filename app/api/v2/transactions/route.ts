import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Transaction, Block } from '@/models/index';
import {
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
  validatePagination,
} from '@/lib/security';

// Blockscout API v2 - Get transactions list
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`transactions:${clientIp}`, 100, 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: 'Rate limit exceeded' },
        { status: 429, headers: getSecurityHeaders() }
      );
    }

    await connectDB();

    // Pagination
    const pagination = validatePagination(searchParams.get('page'), searchParams.get('limit'), 50);
    const skip = (pagination.page - 1) * pagination.limit;

    // Filter by type
    const type = searchParams.get('type'); // token_transfer, contract_creation, etc.

    // Build query
    interface TxQuery {
      creates?: { $exists: boolean; $ne: null };
    }
    let query: TxQuery = {};
    if (type === 'contract_creation') {
      query.creates = { $exists: true, $ne: null };
    }

    // Get transactions
    const transactions = await Transaction.find(query)
      .sort({ blockNumber: -1, transactionIndex: -1 })
      .skip(skip)
      .limit(pagination.limit)
      .lean();

    // Get block info for timestamps
    const blockNumbers = [...new Set(transactions.map((tx) => tx.blockNumber))];
    const blocks = await Block.find({ number: { $in: blockNumbers } })
      .select('number timestamp')
      .lean();
    const blockMap = new Map(blocks.map((b) => [b.number, b]));

    // Format response in Blockscout v2 format
    const items = transactions.map((tx: Record<string, unknown>) => {
      const block = blockMap.get(tx.blockNumber as number);
      return {
        hash: tx.hash,
        block: tx.blockNumber,
        timestamp: block?.timestamp
          ? new Date((block.timestamp as number) * 1000).toISOString()
          : null,
        confirmation_duration: null,
        from: {
          hash: tx.from,
          is_contract: false,
          is_verified: false,
          name: null,
          ens_domain_name: null,
          implementation_name: null,
        },
        to: tx.to
          ? {
              hash: tx.to,
              is_contract: false,
              is_verified: false,
              name: null,
              ens_domain_name: null,
              implementation_name: null,
            }
          : null,
        created_contract: tx.creates
          ? {
              hash: tx.creates,
              is_contract: true,
              is_verified: false,
              name: null,
              ens_domain_name: null,
              implementation_name: null,
            }
          : null,
        value: tx.value?.toString() || '0',
        fee: {
          type: 'actual',
          value: (
            BigInt((tx.gasUsed as number) || 21000) *
            BigInt((tx.gasPrice as string) || '1000000000')
          ).toString(),
        },
        gas_price: tx.gasPrice?.toString() || '0',
        gas_limit: tx.gas?.toString() || '21000',
        gas_used: tx.gasUsed?.toString() || '21000',
        status: tx.status === 0 ? 'error' : 'ok',
        method:
          tx.input && (tx.input as string).length > 10
            ? (tx.input as string).substring(0, 10)
            : null,
        tx_types: tx.creates ? ['contract_creation'] : ['coin_transfer'],
        exchange_rate: null,
        has_error_in_internal_txs: false,
        actions: [],
        decoded_input: null,
        token_transfers: [],
        token_transfers_overflow: false,
        raw_input: tx.input || '0x',
        result: tx.status === 0 ? 'error' : 'success',
        revert_reason: null,
        nonce: tx.nonce,
        position: tx.transactionIndex,
        type: 0,
        max_fee_per_gas: null,
        max_priority_fee_per_gas: null,
        priority_fee: null,
        base_fee_per_gas: null,
        tx_burnt_fee: null,
        tx_tag: null,
      };
    });

    // Get next page info
    const totalCount = await Transaction.countDocuments(query);
    const hasNextPage = skip + transactions.length < totalCount;

    const response = {
      items,
      next_page_params: hasNextPage
        ? {
            block_number: transactions[transactions.length - 1]?.blockNumber,
            index: transactions[transactions.length - 1]?.transactionIndex,
            items_count: pagination.limit,
          }
        : null,
    };

    return NextResponse.json(response, { headers: getSecurityHeaders() });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json(
      {
        message: 'Internal server error',
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}
