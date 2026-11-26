import { NextRequest } from 'next/server';
import { Block, Transaction } from '@/models/index';
import {
  blockCondition,
  headNumber,
  invalidParameter,
  json,
  notFound,
  paginate,
  transactionItems,
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

    const condition = blockCondition(numberOrHash);
    if (!condition) return invalidParameter('Invalid block number or hash');
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
    return json({
      items: await transactionItems(items, head),
      next_page_params,
    });
  });
}
