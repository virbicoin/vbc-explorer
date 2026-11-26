import { NextRequest } from 'next/server';
import { Block } from '@/models/index';
import { sanitizeAddress } from '@/lib/security';
import {
  blockListItems,
  invalidParameter,
  json,
  paginate,
  v2Page,
  v2Route,
} from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

// Blockscout API v2 - blocks mined by an address, newest first
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  return v2Route(request, async () => {
    const address = sanitizeAddress((await params).address);
    if (!address) return invalidParameter('Invalid address');
    const paging = v2Page(new URL(request.url).searchParams);
    if (paging.response) return paging.response;

    const rows = (await Block.find({ miner: address })
      .sort({ number: -1 })
      .skip(paging.page.skip)
      .limit(paging.page.limit + 1)
      .lean()) as Doc[];
    const { items, next_page_params } = paginate(rows, paging.page, (last) => ({
      block_number: last.number,
    }));
    return json({ items: await blockListItems(items), next_page_params });
  });
}
