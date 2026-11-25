import { NextRequest } from 'next/server';
import { Block, InternalTransaction } from '@/models/index';
import { sanitizeHash } from '@/lib/security';
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

// Blockscout API v2 - internal transactions of one block (by height or hash), in block order
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

    const rows = (await InternalTransaction.find({ blockNumber: block.number })
      .sort({ transactionIndex: 1, index: 1 })
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
