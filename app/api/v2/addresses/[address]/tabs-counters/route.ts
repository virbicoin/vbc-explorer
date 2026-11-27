import { NextRequest } from 'next/server';
import {
  Block,
  InternalTransaction,
  Log,
  TokenHolder,
  TokenTransfer,
  Transaction,
} from '@/models/index';
import { sanitizeAddress } from '@/lib/security';
import { getTraceSourceUrl } from '@/lib/config';
import { invalidParameter, json, v2Route } from '@/lib/api/v2/common';

/** Blockscout stops counting a tab at 51, which reads as "more than 50". */
const TAB_LIMIT = 51;

// Blockscout API v2 - the counts shown on the tabs of an address page, each capped at 51 as on
// Blockscout. Logs come from `Log` (tools/logs.ts); withdrawals are not indexed (null), nor
// internal transactions when no trace source is configured.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  return v2Route(request, async () => {
    const address = sanitizeAddress((await params).address);
    if (!address) return invalidParameter('Invalid address');
    const either = { $or: [{ from: address }, { to: address }] };
    const [transactions, tokenTransfers, internalTransactions, tokenBalances, validations, logs] =
      await Promise.all([
        Transaction.countDocuments(either).limit(TAB_LIMIT),
        TokenTransfer.countDocuments(either).limit(TAB_LIMIT),
        getTraceSourceUrl()
          ? InternalTransaction.countDocuments({
              $or: [{ from: address }, { to: address }, { createdContract: address }],
            }).limit(TAB_LIMIT)
          : null,
        TokenHolder.countDocuments({
          holderAddress: address,
          balance: { $nin: ['0', ''], $exists: true },
        }).limit(TAB_LIMIT),
        Block.countDocuments({ miner: address }).limit(TAB_LIMIT),
        Log.countDocuments({ address }).limit(TAB_LIMIT),
      ]);
    return json({
      transactions_count: transactions,
      token_transfers_count: tokenTransfers,
      internal_transactions_count: internalTransactions,
      token_balances_count: tokenBalances,
      validations_count: validations,
      logs_count: logs,
      withdrawals_count: null,
    });
  });
}
