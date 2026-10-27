/**
 * NFT metadata retrieval (tokenURI → JSON) with the SSRF protections of
 * `lib/security/safe-fetch.ts`.
 *
 * - `tokenURI` is only read (and fetched) for contracts that are NFTs
 *   (`isNftContract`); any other contract gets `metadata: null` without a
 *   single network request
 * - the fetched document is never returned as-is: only name, description,
 *   image and attributes are kept, strings are length-capped and control
 *   characters removed, and `image` must pass the same URL validation
 *
 * Dependencies (DB / RPC) are injected so the logic is unit-testable.
 */

import { safeFetchJson, type SafeFetchOptions, type SafeFetchResult } from '../security/safe-fetch';
import { DEFAULT_IPFS_GATEWAY, parseSafeHttpsUrl, resolveIpfsUrl } from '../security/url';

export const NFT_NAME_MAX = 128;
export const NFT_DESCRIPTION_MAX = 2000;
export const NFT_ATTRIBUTES_MAX = 50;
export const NFT_ATTRIBUTE_STRING_MAX = 256;

export interface NftAttribute {
  trait_type: string | null;
  value: string | number | boolean | null;
  display_type?: string;
}

export interface NftMetadata {
  name: string | null;
  description: string | null;
  image: string | null;
  attributes: NftAttribute[];
}

export interface NftMetadataDeps {
  /** True only for ERC-721 / ERC-1155 contracts (DB classification or ERC-165). */
  isNftContract: (address: string) => Promise<boolean>;
  /** `tokenURI(tokenId)` / `uri(id)` via eth_call; null when the call fails. */
  readTokenUri: (address: string, tokenId: number) => Promise<string | null>;
  /** JSON fetcher (defaults to `safeFetchJson`; tests inject a spy). */
  fetchJson?: (url: string, options: SafeFetchOptions) => Promise<SafeFetchResult>;
  ipfsGateway?: string;
}

export interface NftMetadataResult {
  metadata: NftMetadata | null;
  /** The raw tokenURI string as returned by the contract (never fetched when rejected). */
  tokenURI: string | null;
  /** Why the metadata was not fetched / accepted (`not-nft`, `no-token-uri`, or a safe-fetch reason). */
  rejected?: string;
}

/** Remove C0/C1 control characters, zero-width and bidi control code points; keep \n \r \t. */
export function stripControlCharacters(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const isControl =
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0xfeff;
    if (!isControl) out += char;
  }
  return out;
}

function sanitizeText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = stripControlCharacters(value).trim();
  if (!cleaned) return null;
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

function sanitizeAttributeValue(value: unknown): string | number | boolean | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return sanitizeText(value, NFT_ATTRIBUTE_STRING_MAX);
}

/** Keep only the known fields of an NFT metadata document, sanitized. Non-objects → null. */
export function sanitizeNftMetadata(
  raw: unknown,
  options: { ipfsGateway?: string } = {}
): NftMetadata | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const doc = raw as Record<string, unknown>;

  let image: string | null = null;
  if (typeof doc.image === 'string') {
    const resolved = resolveIpfsUrl(doc.image, options.ipfsGateway ?? DEFAULT_IPFS_GATEWAY);
    const parsed = parseSafeHttpsUrl(resolved);
    image = parsed.ok ? parsed.url.toString() : null;
  }

  const attributes: NftAttribute[] = [];
  if (Array.isArray(doc.attributes)) {
    for (const entry of doc.attributes.slice(0, NFT_ATTRIBUTES_MAX)) {
      if (!entry || typeof entry !== 'object') continue;
      const attr = entry as Record<string, unknown>;
      const sanitized: NftAttribute = {
        trait_type: sanitizeText(attr.trait_type, NFT_ATTRIBUTE_STRING_MAX),
        value: sanitizeAttributeValue(attr.value),
      };
      const displayType = sanitizeText(attr.display_type, 32);
      if (displayType) sanitized.display_type = displayType;
      attributes.push(sanitized);
    }
  }

  return {
    name: sanitizeText(doc.name, NFT_NAME_MAX),
    description: sanitizeText(doc.description, NFT_DESCRIPTION_MAX),
    image,
    attributes,
  };
}

/**
 * Read `tokenURI` for an NFT and fetch its metadata safely.
 * Non-NFT contracts never trigger a tokenURI call or a fetch.
 */
export async function fetchNftMetadata(
  address: string,
  tokenId: number,
  deps: NftMetadataDeps
): Promise<NftMetadataResult> {
  const fetchJson = deps.fetchJson ?? safeFetchJson;
  const ipfsGateway = deps.ipfsGateway ?? DEFAULT_IPFS_GATEWAY;

  if (!(await deps.isNftContract(address))) {
    return { metadata: null, tokenURI: null, rejected: 'not-nft' };
  }

  let tokenURI: string | null = null;
  try {
    tokenURI = await deps.readTokenUri(address, tokenId);
  } catch {
    tokenURI = null;
  }
  if (!tokenURI || typeof tokenURI !== 'string' || tokenURI.trim() === '') {
    return { metadata: null, tokenURI: null, rejected: 'no-token-uri' };
  }

  const result = await fetchJson(tokenURI, {
    ipfsGateway,
    context: { contract: address, tokenId },
  });
  if (!result.ok) {
    return { metadata: null, tokenURI, rejected: result.reason };
  }
  const metadata = sanitizeNftMetadata(result.data, { ipfsGateway });
  return { metadata, tokenURI, ...(metadata ? {} : { rejected: 'invalid-metadata' }) };
}
