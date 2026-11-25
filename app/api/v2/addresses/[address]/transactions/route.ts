import { NextRequest } from 'next/server';
import { Transaction } from '@/models/index';
import { sanitizeAddress } from '@/lib/security';
import {
  fillTimestamps,
  headNumber,
  invalidParameter,
  json,
  loadAddressFacts,
  paginate,
  transactionItem,
  v2Page,
  v2Route,
} from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

// Blockscout API v2 - transactions of an address, newest first. `filter` = to | from.
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
        ? { to: address }
        : filter === 'from'
          ? { from: address }
          : { $or: [{ from: address }, { to: address }] };

    // One extra row tells whether a next page exists (no count over the matches)
    const [rows, head] = (await Promise.all([
      Transaction.find(query)
        .sort({ blockNumber: -1, transactionIndex: -1 })
        .skip(paging.page.skip)
        .limit(paging.page.limit + 1)
        .lean(),
      headNumber(),
    ])) as [Doc[], number];
    const { items, next_page_params } = paginate(rows, paging.page, (last) => ({
      block_number: last.blockNumber,
      index: last.transactionIndex,
    }));
    const [facts] = await Promise.all([
      loadAddressFacts(items.flatMap((tx) => [tx.from, tx.to, tx.creates])),
      fillTimestamps(items),
    ]);

    return json({ items: items.map((tx) => transactionItem(tx, head, facts)), next_page_params });
  });
}
