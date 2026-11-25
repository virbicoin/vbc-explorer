import { NextRequest } from 'next/server';
import { Token, TokenHolder } from '@/models/index';
import { sanitizeAddress } from '@/lib/security';
import { ercTokenType } from '@/lib/api/token-standard';
import { invalidParameter, json, paginate, tokenInfo, v2Page, v2Route } from '@/lib/api/v2/common';
import { erc1155HoldingsOf, isMultiTokenType } from '@/lib/api/erc1155';

type Doc = Record<string, unknown>;

function amount(value: unknown): bigint {
  try {
    return BigInt(String(value || '0'));
  } catch {
    return 0n;
  }
}

// Blockscout API v2 - tokens an address holds, largest balance first, in pages.
// `type` is a comma separated list of ERC types. The same rows without paging
// are served by `token-balances`.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  return v2Route(request, async () => {
    const holder = sanitizeAddress((await params).address);
    if (!holder) return invalidParameter('Invalid address');
    const { searchParams } = new URL(request.url);
    const paging = v2Page(searchParams);
    if (paging.response) return paging.response;
    const wanted = (searchParams.get('type') || '')
      .split(',')
      .filter(Boolean)
      .map((type) => ercTokenType(type.trim()));

    const holdings = (
      (await TokenHolder.find({
        holderAddress: holder,
        balance: { $nin: ['0', ''], $exists: true },
      }).lean()) as Doc[]
    ).filter((holding) => amount(holding.balance) > 0n);
    const tokens = (await Token.find({
      address: { $in: holdings.map((holding) => String(holding.tokenAddress)) },
    }).lean()) as Doc[];
    const tokenByAddress = new Map(tokens.map((token) => [String(token.address), token]));

    const listed = holdings
      .map((holding) => {
        const token = tokenByAddress.get(String(holding.tokenAddress));
        return { holding, token, info: tokenInfo(holding.tokenAddress, token) };
      })
      .filter(
        ({ token, info }) => !token?.hidden && (wanted.length === 0 || wanted.includes(info.type))
      );
    // VRC-1155: one row per token id, as on Blockscout
    const perId = await erc1155HoldingsOf(
      holder,
      listed
        .filter(({ token }) => isMultiTokenType(token?.type))
        .map(({ holding }) => String(holding.tokenAddress))
    );
    const rows = listed
      .flatMap(({ holding, token, info }) =>
        isMultiTokenType(token?.type)
          ? (perId.get(String(holding.tokenAddress)) ?? []).map(({ tokenId, value }) => ({
              info,
              tokenId: tokenId as string | null,
              value,
            }))
          : [{ info, tokenId: null as string | null, value: String(holding.balance) }]
      )
      .sort((a, b) => {
        const [x, y] = [amount(a.value), amount(b.value)];
        return x === y ? a.info.address_hash.localeCompare(b.info.address_hash) : x > y ? -1 : 1;
      })
      .slice(paging.page.skip, paging.page.skip + paging.page.limit + 1);
    const { items, next_page_params } = paginate(rows, paging.page, (last) => ({
      value: last.value,
    }));

    return json({
      items: items.map(({ info, tokenId, value }) => ({
        token: info,
        token_id: tokenId,
        token_instance: null,
        value,
      })),
      next_page_params,
    });
  });
}
