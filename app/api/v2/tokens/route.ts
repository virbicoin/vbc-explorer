import { NextRequest } from 'next/server';
import { Token } from '@/models/index';
import { escapeRegex, sanitizeAddress, sanitizeSearchQuery } from '@/lib/security';
import { json, paginate, tokenInfo, tokenTypeFilter, v2Page, v2Route } from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

// Blockscout API v2 - tokens, by number of holders. `q` matches the address or
// the start of the name / symbol; `type` is a comma separated list of ERC types.
export async function GET(request: NextRequest) {
  return v2Route(request, async () => {
    const { searchParams } = new URL(request.url);
    const paging = v2Page(searchParams);
    if (paging.response) return paging.response;

    const conditions: Doc[] = [{ hidden: { $ne: true } }];
    const typeFilter = tokenTypeFilter(searchParams.get('type'));
    if (typeFilter) conditions.push(typeFilter);
    const q = sanitizeSearchQuery(searchParams.get('q') || '', 100).trim();
    if (q) {
      const address = sanitizeAddress(q);
      const starts = { $regex: `^${escapeRegex(q)}`, $options: 'i' };
      conditions.push(address ? { address } : { $or: [{ name: starts }, { symbol: starts }] });
    }

    const rows = (await Token.find({ $and: conditions })
      .sort({ holders: -1, address: 1 })
      .skip(paging.page.skip)
      .limit(paging.page.limit + 1)
      .lean()) as Doc[];
    const { items, next_page_params } = paginate(rows, paging.page, (last) => ({
      contract_address_hash: last.address,
      holders_count: last.holders ?? 0,
    }));

    return json({ items: items.map((token) => tokenInfo(token.address, token)), next_page_params });
  });
}
