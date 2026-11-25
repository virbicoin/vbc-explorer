import { NextRequest } from 'next/server';
import { Token, TokenHolder } from '@/models/index';
import { sanitizeAddress } from '@/lib/security';
import {
  addressParam,
  invalidParameter,
  json,
  loadAddressFacts,
  paginate,
  tokenInfo,
  v2Page,
  v2Route,
} from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

// Blockscout API v2 - holders of a token, by rank
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
      TokenHolder.find({ tokenAddress: address, balance: { $nin: ['0', ''], $exists: true } })
        .sort({ rank: 1 })
        .skip(paging.page.skip)
        .limit(paging.page.limit + 1)
        .lean(),
    ])) as [Doc | null, Doc[]];
    const { items, next_page_params } = paginate(rows, paging.page, (last) => ({
      address_hash: last.holderAddress,
      value: last.balance,
    }));
    const facts = await loadAddressFacts(items.map((holder) => holder.holderAddress));

    return json({
      items: items.map((holder) => ({
        address: addressParam(holder.holderAddress, facts),
        token: tokenInfo(address, token),
        token_id: null,
        value: String(holder.balance),
      })),
      next_page_params,
    });
  });
}
