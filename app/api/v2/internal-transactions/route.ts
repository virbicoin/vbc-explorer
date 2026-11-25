import { NextRequest } from 'next/server';
import { InternalTransaction } from '@/models/index';
import {
  internalTransactionAddresses,
  internalTransactionHint,
  internalTransactionItem,
  json,
  loadAddressFacts,
  paginate,
  v2Page,
  v2Route,
} from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

// Blockscout API v2 - the newest internal transactions of the chain
export async function GET(request: NextRequest) {
  return v2Route(request, async () => {
    const paging = v2Page(new URL(request.url).searchParams);
    if (paging.response) return paging.response;

    const rows = (await InternalTransaction.find({})
      .sort({ blockNumber: -1, transactionIndex: -1, index: -1 })
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
