import { NextRequest } from 'next/server';
import { Token, TokenTransfer } from '@/models/index';
import { sanitizeAddress } from '@/lib/security';
import {
  addressParam,
  type AddressFacts,
  invalidParameter,
  json,
  loadAddressFacts,
  notFound,
  paginate,
  tokenInfo,
  v2Page,
  v2Route,
} from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

const ZERO = '0x0000000000000000000000000000000000000000';

/** A Blockscout token instance; metadata is read by the single-instance endpoint only. */
function instanceItem(
  id: unknown,
  owner: string | null,
  token: ReturnType<typeof tokenInfo>,
  facts?: Map<string, AddressFacts>
) {
  return {
    animation_url: null,
    external_app_url: null,
    id: String(id),
    image_url: null,
    is_unique: token.type === 'ERC-721',
    media_type: null,
    media_url: null,
    metadata: null,
    owner: owner ? addressParam(owner, facts) : null,
    thumbnails: null,
    token,
    token_type: token.type,
  };
}

// Blockscout API v2 - the instances (token ids) of an NFT collection, highest id first, from
// `tokentransfers`. A VRC-721 id belongs to the receiver of its last transfer and burned ids are
// left out; a VRC-1155 id has many holders, so its owner is null, as on Blockscout.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  return v2Route(request, async () => {
    const address = sanitizeAddress((await params).address);
    if (!address) return invalidParameter('Invalid address');
    const paging = v2Page(new URL(request.url).searchParams);
    if (paging.response) return paging.response;

    const token = (await Token.findOne({ address }).lean()) as Doc | null;
    if (!token) return notFound();
    const info = tokenInfo(address, token);
    if (info.type !== 'ERC-721' && info.type !== 'ERC-1155') {
      return json({ items: [], next_page_params: null });
    }
    const unique = info.type === 'ERC-721';
    const rows = (await TokenTransfer.aggregate(
      [
        { $match: { tokenAddress: address, tokenId: { $ne: null } } },
        { $sort: { blockNumber: -1, logIndex: -1, timestamp: -1 } },
        { $group: { _id: '$tokenId', owner: { $first: '$to' } } },
        ...(unique ? [{ $match: { owner: { $ne: ZERO } } }] : []),
        {
          $addFields: {
            order: { $convert: { input: '$_id', to: 'decimal', onError: 0, onNull: 0 } },
          },
        },
        { $sort: { order: -1 } },
        { $skip: paging.page.skip },
        { $limit: paging.page.limit + 1 },
      ],
      { allowDiskUse: true }
    )) as Doc[];
    const { items, next_page_params } = paginate(rows, paging.page, (last) => ({
      unique_token: String(last._id),
    }));
    const facts = unique ? await loadAddressFacts(items.map((row) => row.owner)) : undefined;
    return json({
      items: items.map((row) =>
        instanceItem(row._id, unique ? String(row.owner) : null, info, facts)
      ),
      next_page_params,
    });
  });
}
