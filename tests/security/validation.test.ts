import { describe, it, expect, beforeEach } from 'vitest';
import {
  isValidAddress,
  isValidHash,
  isValidBlockNumber,
  sanitizeAddress,
  sanitizeHash,
  escapeRegex,
  createAddressRegex,
  validatePagination,
  DEFAULT_MAX_OFFSET,
  sanitizeSearchQuery,
  isValidImageUrl,
  sanitizeImageUrl,
  getSecurityHeaders,
  checkRateLimit,
} from '@/lib/security/validation';
import { rejectDeepPagination } from '@/lib/security/pagination';

const VALID_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const VALID_HASH = '0x' + 'a'.repeat(64);

describe('isValidAddress', () => {
  it('accepts a well-formed 40-hex address', () => {
    expect(isValidAddress(VALID_ADDRESS)).toBe(true);
    expect(isValidAddress('0x' + 'A'.repeat(40))).toBe(true);
  });

  it('rejects malformed addresses', () => {
    expect(isValidAddress('0x123')).toBe(false); // too short
    expect(isValidAddress('1234567890abcdef1234567890abcdef12345678')).toBe(false); // no 0x
    expect(isValidAddress('0x' + 'g'.repeat(40))).toBe(false); // non-hex
    expect(isValidAddress('0x' + 'a'.repeat(41))).toBe(false); // too long
    expect(isValidAddress('')).toBe(false);
  });
});

describe('isValidHash', () => {
  it('accepts a well-formed 64-hex hash', () => {
    expect(isValidHash(VALID_HASH)).toBe(true);
  });

  it('rejects malformed hashes', () => {
    expect(isValidHash('0x' + 'a'.repeat(63))).toBe(false);
    expect(isValidHash('0x' + 'a'.repeat(65))).toBe(false);
    expect(isValidHash(VALID_ADDRESS)).toBe(false);
  });
});

describe('isValidBlockNumber', () => {
  it('accepts non-negative integers', () => {
    expect(isValidBlockNumber(0)).toBe(true);
    expect(isValidBlockNumber(12345)).toBe(true);
    expect(isValidBlockNumber('0')).toBe(true);
    expect(isValidBlockNumber('999999')).toBe(true);
  });

  it('accepts named block tags', () => {
    for (const tag of ['latest', 'pending', 'earliest', 'safe', 'finalized']) {
      expect(isValidBlockNumber(tag)).toBe(true);
    }
  });

  it('rejects negatives, decimals and garbage', () => {
    expect(isValidBlockNumber(-1)).toBe(false);
    expect(isValidBlockNumber(1.5)).toBe(false);
    expect(isValidBlockNumber('abc')).toBe(false);
    expect(isValidBlockNumber('-5')).toBe(false);
    expect(isValidBlockNumber('0x10')).toBe(false);
  });
});

describe('sanitizeAddress', () => {
  it('trims and lowercases a valid address', () => {
    expect(sanitizeAddress(`  ${VALID_ADDRESS.toUpperCase()}  `)).toBe(VALID_ADDRESS);
  });

  it('returns null for invalid input', () => {
    expect(sanitizeAddress('not-an-address')).toBeNull();
    expect(sanitizeAddress('')).toBeNull();
    expect(sanitizeAddress(null as unknown as string)).toBeNull();
  });
});

describe('sanitizeHash', () => {
  it('trims and lowercases a valid hash', () => {
    expect(sanitizeHash(`  ${VALID_HASH.toUpperCase()}  `)).toBe(VALID_HASH);
  });

  it('returns null for invalid input', () => {
    expect(sanitizeHash('0x123')).toBeNull();
    expect(sanitizeHash(undefined as unknown as string)).toBeNull();
  });
});

describe('escapeRegex', () => {
  it('escapes all regex metacharacters', () => {
    expect(escapeRegex('a.b*c+d?')).toBe('a\\.b\\*c\\+d\\?');
    expect(escapeRegex('(group)[set]{n}')).toBe('\\(group\\)\\[set\\]\\{n\\}');
  });

  it('leaves plain text untouched', () => {
    expect(escapeRegex('plain text 123')).toBe('plain text 123');
  });
});

describe('createAddressRegex', () => {
  it('produces a case-insensitive anchored regex for valid addresses', () => {
    const re = createAddressRegex(VALID_ADDRESS.toUpperCase());
    expect(re).toBeInstanceOf(RegExp);
    expect(re!.test(VALID_ADDRESS)).toBe(true);
    expect(re!.test(VALID_ADDRESS.toUpperCase())).toBe(true);
    expect(re!.test('0xdeadbeef')).toBe(false);
  });

  it('returns null for invalid addresses', () => {
    expect(createAddressRegex('bad')).toBeNull();
  });
});

describe('validatePagination', () => {
  it('returns defaults when input is missing', () => {
    expect(validatePagination(undefined, undefined)).toMatchObject({ page: 1, limit: 20, skip: 0 });
    expect(validatePagination(null, null)).toMatchObject({ page: 1, limit: 20 });
    expect(validatePagination(null, null, 100, { defaultLimit: 50 })).toMatchObject({ limit: 50 });
    // a default above the cap is capped as well
    expect(validatePagination(null, null, 25, { defaultLimit: 50 })).toMatchObject({ limit: 25 });
  });

  it('parses valid page and limit and computes skip', () => {
    expect(validatePagination('3', '50')).toMatchObject({ page: 3, limit: 50, skip: 100 });
    expect(validatePagination(2, 10)).toMatchObject({ page: 2, limit: 10, skip: 10 });
  });

  it('rounds a limit above the cap down to the cap', () => {
    expect(validatePagination(1, 1000, 100)).toMatchObject({ page: 1, limit: 100 });
    expect(validatePagination(1, '100000', 100)).toMatchObject({ limit: 100 });
    expect(validatePagination(1, 500, 300)).toMatchObject({ limit: 300 });
  });

  it('falls back to default limit for zero, negative or invalid limits', () => {
    expect(validatePagination(1, 0)).toMatchObject({ limit: 20 });
    expect(validatePagination(1, -5)).toMatchObject({ limit: 20 });
    expect(validatePagination(1, 'abc')).toMatchObject({ limit: 20 });
  });

  it('falls back to page 1 for zero, negative, or invalid pages', () => {
    expect(validatePagination(0, 25)).toMatchObject({ page: 1, limit: 25 });
    expect(validatePagination(-3, 25)).toMatchObject({ page: 1 });
    expect(validatePagination('abc', 25)).toMatchObject({ page: 1, limit: 25 });
  });

  it('flags pages deeper than maxOffset', () => {
    expect(validatePagination(1000, 100)).toMatchObject({
      tooDeep: false,
      maxOffset: DEFAULT_MAX_OFFSET,
    });
    expect(validatePagination(1001, 100)).toMatchObject({ tooDeep: true });
    expect(validatePagination(11, 10, 100, { maxOffset: 100 })).toMatchObject({ tooDeep: true });
    expect(validatePagination(10, 10, 100, { maxOffset: 100 })).toMatchObject({ tooDeep: false });
  });
});

describe('rejectDeepPagination', () => {
  it('returns null for shallow pages and a 400 for deep ones', async () => {
    expect(rejectDeepPagination(validatePagination(1, 50))).toBeNull();
    const deep = rejectDeepPagination(validatePagination(5000, 100));
    expect(deep?.status).toBe(400);
    expect(await deep?.json()).toMatchObject({ maxOffset: DEFAULT_MAX_OFFSET });
    const v2 = rejectDeepPagination(validatePagination(5000, 100), 'v2');
    expect(await v2?.json()).toHaveProperty('message');
    const etherscan = rejectDeepPagination(validatePagination(5000, 100), 'etherscan');
    expect(await etherscan?.json()).toMatchObject({ status: '0', result: null });
  });
});

describe('sanitizeSearchQuery', () => {
  it('strips dangerous characters and trims', () => {
    expect(sanitizeSearchQuery('  <script>"&\\  ')).toBe('script');
  });

  it('truncates to the max length', () => {
    expect(sanitizeSearchQuery('a'.repeat(300), 10)).toHaveLength(10);
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeSearchQuery(null as unknown as string)).toBe('');
  });
});

describe('isValidImageUrl', () => {
  it('accepts https image URLs', () => {
    expect(isValidImageUrl('https://example.com/nft.png')).toBe(true);
    expect(isValidImageUrl('https://gateway.ipfs.io/ipfs/Qm123')).toBe(true);
  });

  it('rejects non-https schemes', () => {
    expect(isValidImageUrl('http://example.com/x.png')).toBe(false);
    expect(isValidImageUrl('javascript:alert(1)')).toBe(false);
    expect(isValidImageUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isValidImageUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects https URLs that embed dangerous patterns', () => {
    expect(isValidImageUrl('https://evil.com/x?onerror=alert(1)')).toBe(false);
  });

  it('rejects empty or non-string input', () => {
    expect(isValidImageUrl('')).toBe(false);
    expect(isValidImageUrl(null)).toBe(false);
    expect(isValidImageUrl(undefined)).toBe(false);
    expect(isValidImageUrl('not a url')).toBe(false);
  });
});

describe('sanitizeImageUrl', () => {
  it('returns the trimmed URL when valid', () => {
    expect(sanitizeImageUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
  });

  it('returns null when invalid', () => {
    expect(sanitizeImageUrl('http://example.com/a.png')).toBeNull();
    expect(sanitizeImageUrl(null)).toBeNull();
  });
});

describe('getSecurityHeaders', () => {
  it('returns the expected hardening headers', () => {
    const headers = getSecurityHeaders();
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-XSS-Protection']).toBe('1; mode=block');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });
});

describe('checkRateLimit', () => {
  let key: string;

  beforeEach(() => {
    // Unique key per test so the shared in-memory store does not interfere
    key = `test-${Math.random().toString(36).slice(2)}`;
  });

  it('allows requests while tokens remain', () => {
    const result = checkRateLimit(key, 5, 1);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('blocks once the bucket is exhausted', () => {
    const maxTokens = 3;
    for (let i = 0; i < maxTokens; i++) {
      expect(checkRateLimit(key, maxTokens, 0).allowed).toBe(true);
    }
    const blocked = checkRateLimit(key, maxTokens, 0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });
});
