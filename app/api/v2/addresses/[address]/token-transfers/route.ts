import { NextRequest } from 'next/server';
import { Token, TokenTransfer } from '@/models/index';
import { sanitizeAddress } from '@/lib/security';
import { ercTokenType } from '@/lib/api/token-standard';
import { transferKindFilter } from '@/lib/api/blockscout/account';
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

// Blockscout API v2 - token transfers of an address, newest first.
// `filter` = to | from, `type` = comma separated ERC types, `token` = one contract.
// Transfers of tokens hidden as spam are left out unless that token is asked for.
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

    const query: Doc = {};
    const direction = searchParams.get('filter');
    if (direction === 'to') query.to = address;
    else if (direction === 'from') query.from = address;
    else query.$or = [{ from: address }, { to: address }];

    const tokenParam = searchParams.get('token');
    if (tokenParam) {
      const token = sanitizeAddress(tokenParam);
      if (!token) return invalidParameter('Invalid token');
      query.tokenAddress = token;
    } else {
      const hidden = (await Token.find({ hidden: true }).distinct('address')) as string[];
      if (hidden.length > 0) query.tokenAddress = { $nin: hidden };
    }

    // ERC-20: no tokenId; ERC-721: tokenId; ERC-1155: tokenType (lib/sync/erc1155.ts)
    const types = new Set(
      (searchParams.get('type') || '')
        .split(',')
        .filter(Boolean)
        .map((type) => ercTokenType(type.trim()))
    );
    let condition: Doc = query;
    if (types.size > 0 && types.size < 3) {
      const kinds = [...types].map((type) =>
        transferKindFilter(
          type === 'ERC-1155' ? 'erc1155' : type === 'ERC-721' ? 'erc721' : 'erc20'
        )
      );
      condition = { $and: [query, kinds.length === 1 ? kinds[0] : { $or: kinds }] };
    }

    const rows = (await TokenTransfer.find(condition)
      .sort({ timestamp: -1 })
      .skip(paging.page.skip)
      .limit(paging.page.limit + 1)
      .lean()) as Doc[];
    const { items, next_page_params } = paginate(rows, paging.page, (last) => ({
      block_number: Number(last.blockNumber),
    }));

    const [tokens, facts] = await Promise.all([
      Token.find({
        address: { $in: [...new Set(items.map((t) => String(t.tokenAddress)))] },
      }).lean(),
      loadAddressFacts(items.flatMap((transfer) => [transfer.from, transfer.to])),
    ]);
    const tokenByAddress = new Map(
      (tokens as Doc[]).map((token) => [String(token.address), token])
    );

    return json({
      items: items.map((transfer) =>
        tokenTransferItem(transfer, tokenByAddress.get(String(transfer.tokenAddress)), facts)
      ),
      next_page_params,
    });
  });
}
