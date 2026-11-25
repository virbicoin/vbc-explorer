import { NextRequest } from 'next/server';
import { Token, TokenTransfer } from '@/models/index';
import { sanitizeAddress } from '@/lib/security';
import {
  invalidParameter,
  json,
  loadAddressFacts,
  paginate,
  tokenTransferItem,
  v2Page,
  v2Route,
} from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

// Blockscout API v2 - transfers of a token, newest first
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  return v2Route(request, async () => {
    const address = sanitizeAddress((await params).address);
    if (!address) return invalidParameter('Invalid address');
    const paging = v2Page(new URL(request.url).searchParams);
    if (paging.response) return paging.response;

    const [token, rows] = (await Promise.all([
      Token.findOne({ address }).lean(),
      TokenTransfer.find({ tokenAddress: address })
        .sort({ timestamp: -1 })
        .skip(paging.page.skip)
        .limit(paging.page.limit + 1)
        .lean(),
    ])) as [Doc | null, Doc[]];
    const { items, next_page_params } = paginate(rows, paging.page, (last) => ({
      block_number: Number(last.blockNumber),
    }));
    const facts = await loadAddressFacts(items.flatMap((transfer) => [transfer.from, transfer.to]));

    return json({
      items: items.map((transfer) => tokenTransferItem(transfer, token, facts)),
      next_page_params,
    });
  });
}
