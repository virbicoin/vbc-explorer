import { NextRequest, NextResponse } from 'next/server';
import { connectDB, Transaction, Block } from '@/models/index';
import {
  isValidHash,
  checkRateLimit,
  getClientIp,
  getSecurityHeaders,
} from '@/lib/security';

// Blockscout API v2 - Get transaction by hash
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  try {
    const { hash } = await params;

    // Rate limiting
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(`tx:${clientIp}`, 100, 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: 'Rate limit exceeded' },
        { status: 429, headers: getSecurityHeaders() }
      );
    }

    // Validate hash
    if (!isValidHash(hash)) {
      return NextResponse.json(
        { message: 'Invalid transaction hash' },
        { status: 400, headers: getSecurityHeaders() }
      );
    }

    await connectDB();

    // Get transaction
    const tx = await Transaction.findOne({
      hash: hash.toLowerCase(),
    }).lean() as Record<string, unknown> | null;

    if (!tx) {
      return NextResponse.json(
        { message: 'Transaction not found' },
        { status: 404, headers: getSecurityHeaders() }
      );
    }

    // Get block info
    const block = await Block.findOne({ number: tx.blockNumber }).lean();

    // Format response in Blockscout v2 format
    const response = {
      hash: tx.hash,
      block: tx.blockNumber,
      timestamp: block?.timestamp
        ? new Date((block.timestamp as number) * 1000).toISOString()
        : null,
      confirmation_duration: null,
      confirmations: block ? 1 : 0,
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
          BigInt(tx.gasUsed as number || 21000) *
          BigInt(tx.gasPrice as string || '1000000000')
        ).toString(),
      },
      gas_price: tx.gasPrice?.toString() || '0',
      gas_limit: tx.gas?.toString() || '21000',
      gas_used: tx.gasUsed?.toString() || '21000',
      status: tx.status === 0 ? 'error' : 'ok',
      method: tx.input && (tx.input as string).length > 10
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

    return NextResponse.json(response, { headers: getSecurityHeaders() });
  } catch (error) {
    console.error('Error fetching transaction:', error);
    return NextResponse.json(
      {
        message: 'Internal server error',
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      },
      { status: 500, headers: getSecurityHeaders() }
    );
  }
}
