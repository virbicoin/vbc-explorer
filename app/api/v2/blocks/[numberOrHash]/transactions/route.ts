import { NextRequest } from 'next/server';
import { Block, Transaction } from '@/models/index';
import { sanitizeHash } from '@/lib/security';
import {
  fillTimestamps,
  headNumber,
  invalidParameter,
  json,
  loadAddressFacts,
  notFound,
  paginate,
  transactionItem,
  v2Page,
  v2Route,
} from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

// Blockscout API v2 - transactions of one block (by height or hash)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ numberOrHash: string }> }
) {
  return v2Route(request, async () => {
    const { numberOrHash } = await params;
    const paging = v2Page(new URL(request.url).searchParams);
    if (paging.response) return paging.response;

    let condition: Doc;
    if (/^\d{1,15}$/.test(numberOrHash)) condition = { number: Number(numberOrHash) };
    else {
      const hash = sanitizeHash(numberOrHash);
      if (!hash) return invalidParameter('Invalid block number or hash');
      condition = { hash };
    }
    const block = (await Block.findOne(condition).select('number').lean()) as {
      number: number;
    } | null;
    if (!block) return notFound();

    const [rows, head] = (await Promise.all([
      Transaction.find({ blockNumber: block.number })
        .sort({ transactionIndex: -1 })
        .skip(paging.page.skip)
        .limit(paging.page.limit + 1)
        .lean(),
      headNumber(),
    ])) as [Doc[], number];
    const { items, next_page_params } = paginate(rows, paging.page, (last) => ({
      block_number: block.number,
      index: last.transactionIndex,
    }));
    const [facts] = await Promise.all([
      loadAddressFacts(items.flatMap((tx) => [tx.from, tx.to, tx.creates])),
      fillTimestamps(items),
    ]);

    return json({ items: items.map((tx) => transactionItem(tx, head, facts)), next_page_params });
  });
}
