import { describe, expect, it } from 'vitest';
import {
  isIpLiteral,
  isPrivateIp,
  parseIpv6,
  parseSafeHttpsUrl,
  resolveIpfsUrl,
} from '@/lib/security/url';

describe('resolveIpfsUrl', () => {
  it('rewrites ipfs:// URIs to the gateway', () => {
    expect(resolveIpfsUrl('ipfs://QmAbc/1.json')).toBe('https://ipfs.io/ipfs/QmAbc/1.json');
    expect(resolveIpfsUrl('ipfs://ipfs/QmAbc')).toBe('https://ipfs.io/ipfs/QmAbc');
    expect(resolveIpfsUrl('ipfs://QmAbc', 'https://gw.example/ipfs')).toBe(
      'https://gw.example/ipfs/QmAbc'
    );
  });

  it('leaves other URLs unchanged', () => {
    expect(resolveIpfsUrl('https://example.com/a.json')).toBe('https://example.com/a.json');
    expect(resolveIpfsUrl('http://x/')).toBe('http://x/');
  });
});

describe('parseIpv6', () => {
  it('expands compressed and mapped forms', () => {
    expect(parseIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6('[::ffff:127.0.0.1]')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001]);
    expect(parseIpv6('fe80::1%eth0')?.[0]).toBe(0xfe80);
    expect(parseIpv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('rejects malformed input', () => {
    expect(parseIpv6('1:2:3')).toBeNull();
    expect(parseIpv6('1::2::3')).toBeNull();
    expect(parseIpv6('zz::1')).toBeNull();
    expect(parseIpv6('127.0.0.1')).toBeNull();
  });
});

describe('isPrivateIp', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.255',
    '10.0.0.1',
    '172.16.5.5',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.1.1',
    '0.0.0.0',
    '0.1.2.3',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.1.1.1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::1',
    '::1.2.3.4',
    'not-an-ip',
  ])('rejects %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '93.184.216.34',
    '172.32.0.1',
    '172.15.0.1',
    '100.63.0.1',
    '100.128.0.1',
    '2001:db8::1',
    '2606:4700::1111',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
  ])('accepts public %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('isIpLiteral', () => {
  it('detects IPv4 and IPv6 literals (bracketed or not)', () => {
    expect(isIpLiteral('127.0.0.1')).toBe(true);
    expect(isIpLiteral('[::1]')).toBe(true);
    expect(isIpLiteral('::1')).toBe(true);
    expect(isIpLiteral('example.com')).toBe(false);
    expect(isIpLiteral('localhost')).toBe(false);
  });
});

describe('parseSafeHttpsUrl', () => {
  it('accepts a plain https URL with a DNS name', () => {
    const result = parseSafeHttpsUrl('https://example.com/meta/1.json?x=1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url.hostname).toBe('example.com');
  });

  it.each([
    ['http://example.com/a.json', 'scheme'],
    ['ftp://example.com/a.json', 'scheme'],
    ['javascript:alert(1)', 'dangerous'],
    ['data:application/json;base64,e30=', 'dangerous'],
    ['https://example.com/x?onerror=alert(1)', 'dangerous'],
    ['https://user:pw@example.com/', 'credentials'],
    ['https://127.0.0.1/version', 'ip-literal'],
    ['https://[::1]/version', 'ip-literal'],
    ['https://169.254.169.254/latest/meta-data', 'ip-literal'],
    ['https://2130706433/', 'ip-literal'], // decimal form of 127.0.0.1 (normalized by the URL parser)
    ['https://0x7f000001/', 'ip-literal'],
    ['not a url', 'invalid-url'],
    ['', 'invalid-url'],
  ])('rejects %s (%s)', (input, reason) => {
    expect(parseSafeHttpsUrl(input)).toEqual({ ok: false, reason });
  });

  it('allows http://localhost only when explicitly enabled', () => {
    expect(parseSafeHttpsUrl('http://localhost:3000/a.png').ok).toBe(false);
    expect(parseSafeHttpsUrl('http://localhost:3000/a.png', { allowHttpLocalhost: true }).ok).toBe(
      true
    );
    expect(parseSafeHttpsUrl('http://127.0.0.1/a.png', { allowHttpLocalhost: true }).ok).toBe(true);
    expect(parseSafeHttpsUrl('http://10.0.0.1/a.png', { allowHttpLocalhost: true }).ok).toBe(false);
  });
});
