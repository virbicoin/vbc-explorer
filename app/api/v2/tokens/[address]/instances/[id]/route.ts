import { NextRequest } from 'next/server';
import { Token, TokenTransfer } from '@/models/index';
import { readConfig } from '@/lib/config';
import { sanitizeAddress } from '@/lib/security';
import { enforceRateLimit } from '@/lib/security/rate-limits';
import { fetchNftMetadata, isNftContract, readTokenUri } from '@/lib/services/nft-metadata.service';
import {
  addressParam,
  invalidParameter,
  json,
  loadAddressFacts,
  notFound,
  tokenInfo,
  v2Route,
} from '@/lib/api/v2/common';

type Doc = Record<string, unknown>;

const ZERO = '0x0000000000000000000000000000000000000000';

// Blockscout API v2 - one NFT instance: its owner (VRC-721: the receiver of the last transfer)
// and the metadata read from tokenURI through safeFetchJson (the tokenMetadata rate limit
// applies, as on /api/tokens/[address]?tokenId=).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string; id: string }> }
) {
  return v2Route(request, async () => {
    const { address: rawAddress, id } = await params;
    const address = sanitizeAddress(rawAddress);
    if (!address) return invalidParameter('Invalid address');
    if (!/^\d{1,78}$/.test(id)) return invalidParameter('Invalid token id');

    const token = (await Token.findOne({ address }).lean()) as Doc | null;
    if (!token) return notFound();
    const info = tokenInfo(address, token);
    if (info.type !== 'ERC-721' && info.type !== 'ERC-1155') return notFound();
    // VRC-721 ids are stored as numbers, VRC-1155 ids as decimal strings: read through the
    // driver, since Mongoose would cast the string to a number
    const ids: unknown[] = [id, ...(Number.isSafeInteger(Number(id)) ? [Number(id)] : [])];
    const last = (await TokenTransfer.collection
      .find({ tokenAddress: address, tokenId: { $in: ids } })
      .sort({ blockNumber: -1, logIndex: -1, timestamp: -1 })
      .limit(1)
      .next()) as Doc | null;
    if (!last) return notFound();

    const limited = enforceRateLimit(request, 'tokenMetadata', { format: 'v2' });
    if (limited) return limited;
    const { metadata } = Number.isSafeInteger(Number(id))
      ? await fetchNftMetadata(address, Number(id), {
          isNftContract,
          readTokenUri,
          ipfsGateway: readConfig().images?.ipfsGateway,
        })
      : { metadata: null };
    const unique = info.type === 'ERC-721';
    const owner = unique && last.to !== ZERO ? String(last.to) : null;
    const facts = owner ? await loadAddressFacts([owner]) : undefined;
    return json({
      animation_url: null,
      external_app_url: null,
      id,
      image_url: metadata?.image ?? null,
      is_unique: unique,
      media_type: null,
      media_url: metadata?.image ?? null,
      metadata,
      owner: owner ? addressParam(owner, facts) : null,
      thumbnails: null,
      token: info,
      token_type: info.type,
    });
  });
}
