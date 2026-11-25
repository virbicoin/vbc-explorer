import { NextRequest } from 'next/server';
import { InternalTransaction } from '@/models/index';
import { sanitizeAddress } from '@/lib/security';
import {
  internalTransactionAddresses,
  internalTransactionHint,
  internalTransactionItem,
  invalidParameter,
  json,
  loadAddressFacts,
  paginate,
  v2Page,
  v2Route,
} from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

// Blockscout API v2 - internal transactions of an address (sender, receiver or created
// contract), newest first. `filter` = to | from.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  return v2Route(request, async () => {
    const address = sanitizeAddress((await params).address);
    if (!address) return invalidParameter('Invalid address');
    const { searchParams } = new URL(request.url);
    const paging = v2Page(searchParams);
    if (paging.response) return paging.response;

    const filter = searchParams.get('filter');
    const query: Doc =
      filter === 'to'
        ? { $or: [{ to: address }, { createdContract: address }] }
        : filter === 'from'
          ? { from: address }
          : { $or: [{ from: address }, { to: address }, { createdContract: address }] };

    const rows = (await InternalTransaction.find(query)
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
