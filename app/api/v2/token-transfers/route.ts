import { NextRequest } from 'next/server';
import { Token, TokenTransfer } from '@/models/index';
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

const KINDS: Record<string, 'erc20' | 'erc721' | 'erc1155'> = {
  'ERC-20': 'erc20',
  'ERC-721': 'erc721',
  'ERC-1155': 'erc1155',
};

// Blockscout API v2 - the token transfers of the whole chain, newest first. `type` narrows them
// to a comma-separated list of ERC-20, ERC-721 and ERC-1155. Transfers of tokens hidden as spam
// are left out, as in the other lists.
export async function GET(request: NextRequest) {
  return v2Route(request, async () => {
    const { searchParams } = new URL(request.url);
    const paging = v2Page(searchParams);
    if (paging.response) return paging.response;

    const types = (searchParams.get('type') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (types.some((type) => !KINDS[type])) return invalidParameter('Invalid type');
    const hidden = (await Token.find({ hidden: true }).select('address').lean()) as Doc[];
    const query: Doc = {
      ...(hidden.length > 0
        ? { tokenAddress: { $nin: hidden.map((token) => token.address) } }
        : {}),
      ...(types.length > 0 ? { $or: types.map((type) => transferKindFilter(KINDS[type])) } : {}),
    };
    const rows = (await TokenTransfer.find(query)
      .sort({ timestamp: -1 })
      .skip(paging.page.skip)
      .limit(paging.page.limit + 1)
      .lean()) as Doc[];
    const { items, next_page_params } = paginate(rows, paging.page, (last) => ({
      block_number: Number(last.blockNumber),
    }));
    const tokenAddresses = [...new Set(items.map((transfer) => transfer.tokenAddress))];
    const [tokens, facts] = await Promise.all([
      Token.find({ address: { $in: tokenAddresses } }).lean() as Promise<Doc[]>,
      loadAddressFacts(items.flatMap((transfer) => [transfer.from, transfer.to])),
    ]);
    const byAddress = new Map(tokens.map((token) => [String(token.address), token]));
    return json({
      items: items.map((transfer) =>
        tokenTransferItem(transfer, byAddress.get(String(transfer.tokenAddress)), facts)
      ),
      next_page_params,
    });
  });
}
