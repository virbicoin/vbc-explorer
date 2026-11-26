import { NextRequest } from 'next/server';
import { Transaction } from '@/models/index';
import { json, transactionItems, v2Route } from '@/lib/api/v2/common';

// Blockscout API v2 - the newest transactions for a home page: an array of 6, as on Blockscout
export async function GET(request: NextRequest) {
  return v2Route(request, async () => {
    const txs = (await Transaction.find()
      .sort({ blockNumber: -1, transactionIndex: -1 })
      .limit(6)
      .lean()) as Array<Record<string, unknown>>;
    return json(await transactionItems(txs));
  });
}
