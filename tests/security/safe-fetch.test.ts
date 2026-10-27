import { describe, expect, it, vi } from 'vitest';
import {
  isJsonContentType,
  safeFetchJson,
  type LookupFn,
  type Transport,
  type TransportResponse,
} from '@/lib/security/safe-fetch';

const PUBLIC_IP = '93.184.216.34';

function lookupTable(table: Record<string, string[]>): LookupFn {
  return async (hostname) => {
    const addresses = table[hostname];
    if (!addresses) throw new Error(`ENOTFOUND ${hostname}`);
    return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
}

function jsonResponse(
  body: unknown,
  overrides: Partial<TransportResponse> = {}
): TransportResponse {
  const buffer = Buffer.from(JSON.stringify(body));
  return {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-length': String(buffer.length) },
    body: buffer,
    truncated: false,
    ...overrides,
  };
}

function transportReturning(response: TransportResponse | Error) {
  return vi.fn<Transport>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}

const publicLookup = lookupTable({
  'example.com': [PUBLIC_IP],
  'ipfs.io': [PUBLIC_IP],
  localhost: ['127.0.0.1', '::1'],
  'evil.example': ['10.0.0.1'],
  'mixed.example': [PUBLIC_IP, '::1'],
});

describe('safeFetchJson', () => {
  it('fetches public https JSON and connects to the validated address', async () => {
    const transport = transportReturning(jsonResponse({ name: 'Token #1' }));
    const result = await safeFetchJson('https://example.com/meta/1.json', {
      lookup: publicLookup,
      transport,
    });
    expect(result).toMatchObject({ ok: true, data: { name: 'Token #1' } });
    expect(transport).toHaveBeenCalledTimes(1);
    const request = transport.mock.calls[0][0];
    expect(request.address).toEqual({ address: PUBLIC_IP, family: 4 });
    expect(request.url.hostname).toBe('example.com');
    expect(request.headers.Accept).toBe('application/json');
  });

  it('rewrites ipfs:// to the configured gateway before fetching', async () => {
    const transport = transportReturning(jsonResponse({ ok: 1 }));
    const result = await safeFetchJson('ipfs://QmAbc/1.json', {
      lookup: publicLookup,
      transport,
      ipfsGateway: 'https://ipfs.io/ipfs/',
    });
    expect(result.ok).toBe(true);
    expect(transport.mock.calls[0][0].url.toString()).toBe('https://ipfs.io/ipfs/QmAbc/1.json');
  });

  it.each([
    ['http://example.com/meta.json', 'scheme'],
    ['https://127.0.0.1:2375/version', 'ip-literal'],
    ['https://[::1]:2379/version', 'ip-literal'],
    ['https://169.254.169.254/latest/meta-data/', 'ip-literal'],
    ['https://10.0.0.1/', 'ip-literal'],
    ['javascript:alert(1)', 'dangerous'],
    ['data:application/json,{}', 'dangerous'],
  ])('rejects %s before any network activity (%s)', async (url, reason) => {
    const transport = transportReturning(jsonResponse({}));
    const lookup = vi.fn<LookupFn>(publicLookup);
    const result = await safeFetchJson(url, { lookup, transport });
    expect(result).toMatchObject({ ok: false, reason });
    expect(lookup).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    ['https://localhost/version', 'private-address'],
    ['https://evil.example/pods', 'private-address'],
    ['https://mixed.example/x', 'private-address'],
    ['https://unknown.example/x', 'dns'],
  ])('rejects %s after DNS resolution (%s) without connecting', async (url, reason) => {
    const transport = transportReturning(jsonResponse({}));
    const result = await safeFetchJson(url, { lookup: publicLookup, transport });
    expect(result).toMatchObject({ ok: false, reason });
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not follow redirects (even to public hosts)', async () => {
    const transport = transportReturning({
      status: 302,
      headers: { location: 'http://127.0.0.1:2375/version' },
      body: Buffer.alloc(0),
      truncated: false,
    });
    const result = await safeFetchJson('https://example.com/r', {
      lookup: publicLookup,
      transport,
    });
    expect(result).toMatchObject({ ok: false, reason: 'redirect', status: 302 });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects non-JSON content types and invalid JSON', async () => {
    const html = transportReturning(
      jsonResponse({}, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    );
    expect(
      await safeFetchJson('https://example.com/a', { lookup: publicLookup, transport: html })
    ).toMatchObject({ ok: false, reason: 'content-type' });

    const broken = transportReturning({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{not json'),
      truncated: false,
    });
    expect(
      await safeFetchJson('https://example.com/a', { lookup: publicLookup, transport: broken })
    ).toMatchObject({ ok: false, reason: 'invalid-json' });
  });

  it('rejects oversized bodies by Content-Length and by actual size', async () => {
    const declared = transportReturning(
      jsonResponse(
        {},
        { headers: { 'content-type': 'application/json', 'content-length': '999999' } }
      )
    );
    expect(
      await safeFetchJson('https://example.com/a', { lookup: publicLookup, transport: declared })
    ).toMatchObject({ ok: false, reason: 'too-large' });

    const truncated = transportReturning({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.alloc(64, 'a'),
      truncated: true,
    });
    expect(
      await safeFetchJson('https://example.com/a', {
        lookup: publicLookup,
        transport: truncated,
        maxBytes: 64,
      })
    ).toMatchObject({ ok: false, reason: 'too-large' });
  });

  it('maps non-200 statuses, timeouts and network errors to reasons', async () => {
    expect(
      await safeFetchJson('https://example.com/a', {
        lookup: publicLookup,
        transport: transportReturning(jsonResponse({}, { status: 404 })),
      })
    ).toMatchObject({ ok: false, reason: 'status', status: 404 });
    expect(
      await safeFetchJson('https://example.com/a', {
        lookup: publicLookup,
        transport: transportReturning(new Error('timeout')),
      })
    ).toMatchObject({ ok: false, reason: 'timeout' });
    expect(
      await safeFetchJson('https://example.com/a', {
        lookup: publicLookup,
        transport: transportReturning(new Error('ECONNRESET')),
      })
    ).toMatchObject({ ok: false, reason: 'network' });
  });
});

describe('isJsonContentType', () => {
  it('accepts application/json and +json types only', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true);
    expect(isJsonContentType('application/ld+json')).toBe(true);
    expect(isJsonContentType('text/plain')).toBe(false);
    expect(isJsonContentType('text/html')).toBe(false);
    expect(isJsonContentType(undefined)).toBe(false);
  });
});
