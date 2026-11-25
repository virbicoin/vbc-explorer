import { NextRequest } from 'next/server';
import { Block, TokenTransfer, Transaction } from '@/models/index';
import { sanitizeAddress } from '@/lib/security';
import { invalidParameter, json, v2Route } from '@/lib/api/v2/common';

// Blockscout API v2 - counters of an address: transactions, token transfers,
// gas used by the transactions it sent, and blocks it mined.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  return v2Route(request, async () => {
    const address = sanitizeAddress((await params).address);
    if (!address) return invalidParameter('Invalid address');
    const either = { $or: [{ from: address }, { to: address }] };

    const [transactions, tokenTransfers, gas, mined] = await Promise.all([
      Transaction.countDocuments(either),
      TokenTransfer.countDocuments(either),
      Transaction.aggregate([
        { $match: { from: address } },
        { $group: { _id: null, total: { $sum: '$gasUsed' } } },
      ]),
      Block.countDocuments({ miner: address }),
    ]);

    return json({
      transactions_count: String(transactions),
      token_transfers_count: String(tokenTransfers),
      gas_usage_count: String(gas[0]?.total ?? 0),
      validations_count: String(mined),
    });
  });
}
