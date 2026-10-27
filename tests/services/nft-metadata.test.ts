import { describe, expect, it, vi } from 'vitest';
import {
  fetchNftMetadata,
  sanitizeNftMetadata,
  stripControlCharacters,
  NFT_DESCRIPTION_MAX,
  NFT_ATTRIBUTES_MAX,
} from '@/lib/services/nft-metadata.service';
import { safeFetchJson, type LookupFn, type Transport } from '@/lib/security/safe-fetch';

const PUBLIC_IP = '93.184.216.34';
const lookup: LookupFn = async (hostname) =>
  hostname === 'meta.example' || hostname === 'ipfs.io'
    ? [{ address: PUBLIC_IP, family: 4 }]
    : [{ address: '127.0.0.1', family: 4 }];

describe('fetchNftMetadata', () => {
  it('never reads tokenURI or fetches for a non-NFT (ERC-20) contract', async () => {
    const readTokenUri = vi.fn(async () => 'https://meta.example/1.json');
    const fetchJson = vi.fn(async () => ({ ok: true as const, url: '', data: {}, bytes: 2 }));
    const result = await fetchNftMetadata('0xabc', 1, {
      isNftContract: async () => false,
      readTokenUri,
      fetchJson,
    });
    expect(result).toEqual({ metadata: null, tokenURI: null, rejected: 'not-nft' });
    expect(readTokenUri).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('rejects an internal tokenURI without opening a connection', async () => {
    const transport = vi.fn<Transport>();
    const result = await fetchNftMetadata('0xabc', 1, {
      isNftContract: async () => true,
      readTokenUri: async () => 'https://127.0.0.1:2375/version',
      fetchJson: (url, options) => safeFetchJson(url, { ...options, lookup, transport }),
    });
    expect(result).toEqual({
      metadata: null,
      tokenURI: 'https://127.0.0.1:2375/version',
      rejected: 'ip-literal',
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects a hostname that resolves to a private address', async () => {
    const transport = vi.fn<Transport>();
    const result = await fetchNftMetadata('0xabc', 1, {
      isNftContract: async () => true,
      readTokenUri: async () => 'https://internal.example/pods',
      fetchJson: (url, options) => safeFetchJson(url, { ...options, lookup, transport }),
    });
    expect(result.rejected).toBe('private-address');
    expect(result.metadata).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });

  it('returns only the sanitized fields of a public metadata document', async () => {
    const transport = vi.fn<Transport>(async () => {
      const body = Buffer.from(
        JSON.stringify({
          name: 'Cool​ NFT\u0000',
          description: 'x'.repeat(NFT_DESCRIPTION_MAX + 50),
          image: 'ipfs://QmImage/1.png',
          attributes: new Array(NFT_ATTRIBUTES_MAX + 10).fill({
            trait_type: 'rarity',
            value: 'rare',
          }),
          external_url: 'https://dropped.example',
          animation_url: 'https://dropped.example/a.mp4',
        })
      );
      return {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': String(body.length) },
        body,
        truncated: false,
      };
    });
    const result = await fetchNftMetadata('0xabc', 7, {
      isNftContract: async () => true,
      readTokenUri: async () => 'https://meta.example/7.json',
      fetchJson: (url, options) => safeFetchJson(url, { ...options, lookup, transport }),
      ipfsGateway: 'https://ipfs.io/ipfs/',
    });
    expect(result.tokenURI).toBe('https://meta.example/7.json');
    expect(result.rejected).toBeUndefined();
    expect(result.metadata).toEqual({
      name: 'Cool NFT',
      description: 'x'.repeat(NFT_DESCRIPTION_MAX),
      image: 'https://ipfs.io/ipfs/QmImage/1.png',
      attributes: new Array(NFT_ATTRIBUTES_MAX).fill({ trait_type: 'rarity', value: 'rare' }),
    });
    expect(result.metadata).not.toHaveProperty('external_url');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('returns no metadata when tokenURI is empty or the call fails', async () => {
    const fetchJson = vi.fn(async () => ({ ok: true as const, url: '', data: {}, bytes: 2 }));
    expect(
      await fetchNftMetadata('0xabc', 1, {
        isNftContract: async () => true,
        readTokenUri: async () => '',
        fetchJson,
      })
    ).toEqual({ metadata: null, tokenURI: null, rejected: 'no-token-uri' });
    expect(
      await fetchNftMetadata('0xabc', 1, {
        isNftContract: async () => true,
        readTokenUri: async () => {
          throw new Error('revert');
        },
        fetchJson,
      })
    ).toEqual({ metadata: null, tokenURI: null, rejected: 'no-token-uri' });
    expect(fetchJson).not.toHaveBeenCalled();
  });
});

describe('sanitizeNftMetadata', () => {
  it('drops unsafe images and non-object documents', () => {
    expect(sanitizeNftMetadata(null)).toBeNull();
    expect(sanitizeNftMetadata('str')).toBeNull();
    expect(sanitizeNftMetadata([1, 2])).toBeNull();
    expect(sanitizeNftMetadata({ image: 'http://example.com/a.png' })?.image).toBeNull();
    expect(sanitizeNftMetadata({ image: 'https://127.0.0.1/a.png' })?.image).toBeNull();
    expect(sanitizeNftMetadata({ image: 'javascript:alert(1)' })?.image).toBeNull();
    expect(sanitizeNftMetadata({ image: 'https://cdn.example/a.png' })?.image).toBe(
      'https://cdn.example/a.png'
    );
  });

  it('keeps numeric and boolean attribute values and caps strings', () => {
    const meta = sanitizeNftMetadata({
      name: 42,
      attributes: [
        { trait_type: 'level', value: 3, display_type: 'number' },
        { trait_type: 'shiny', value: true },
        { trait_type: 'x'.repeat(300), value: 'y'.repeat(300) },
        'garbage',
      ],
    });
    expect(meta?.name).toBeNull();
    expect(meta?.attributes).toEqual([
      { trait_type: 'level', value: 3, display_type: 'number' },
      { trait_type: 'shiny', value: true },
      { trait_type: 'x'.repeat(256), value: 'y'.repeat(256) },
    ]);
  });
});

describe('stripControlCharacters', () => {
  it('removes control, zero-width and bidi characters but keeps newlines and tabs', () => {
    expect(stripControlCharacters('a\u0000b​c‮d⁦e﻿\n\tf')).toBe('abcde\n\tf');
    expect(stripControlCharacters('日本語トークン')).toBe('日本語トークン');
  });
});
