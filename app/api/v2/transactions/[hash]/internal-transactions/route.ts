import { NextRequest } from 'next/server';
import { InternalTransaction, Transaction } from '@/models/index';
import { isValidHash } from '@/lib/security';
import {
  internalTransactionAddresses,
  internalTransactionHint,
  internalTransactionItem,
  invalidParameter,
  json,
  loadAddressFacts,
  notFound,
  paginate,
  v2Page,
  v2Route,
} from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

// Blockscout API v2 - internal transactions of a transaction, in trace order
// (tools/internal-txs.ts; the top-level call is the transaction itself and not listed).
export async function GET(request: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  return v2Route(request, async () => {
    const { hash } = await params;
    if (!isValidHash(hash)) return invalidParameter('Invalid transaction hash');
    const txHash = hash.toLowerCase();
    const { searchParams } = new URL(request.url);
    const paging = v2Page(searchParams);
    if (paging.response) return paging.response;

    if (!(await Transaction.exists({ hash: txHash }))) return notFound();

    const rows = (await InternalTransaction.find({ transactionHash: txHash })
      .sort({ index: 1 })
      .skip(paging.page.skip)
      .limit(paging.page.limit + 1)
      .lean()) as Doc[];
    const { items, next_page_params } = paginate(rows, paging.page, internalTransactionHint);
    const facts = await loadAddressFacts(internalTransactionAddresses(items));
    return json({
      items: items.map((doc) => internalTransactionItem(doc, facts)),
      next_page_params,
    });
  });
}
