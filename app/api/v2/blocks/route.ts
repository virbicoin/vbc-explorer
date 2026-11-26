import { NextRequest } from 'next/server';
import { Block } from '@/models/index';
import { blockListItems, json, paginate, v2Page, v2Route } from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

// Blockscout API v2 - blocks, newest first. Only consensus blocks are stored, so the
// `type=uncle` and `type=reorg` lists are empty.
export async function GET(request: NextRequest) {
  return v2Route(request, async () => {
    const { searchParams } = new URL(request.url);
    const paging = v2Page(searchParams);
    if (paging.response) return paging.response;
    const type = searchParams.get('type');
    if (type === 'uncle' || type === 'reorg') return json({ items: [], next_page_params: null });

    // One extra row tells whether a next page exists (no count over the collection)
    const rows = (await Block.find()
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
