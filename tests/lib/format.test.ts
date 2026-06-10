import { describe, it, expect } from 'vitest';
import {
  formatTokenBalance,
  formatNumber,
  formatEther,
  shortenAddress,
  timeAgo,
  formatPercentage,
  formatHashrate,
  formatBytes,
  formatDifficulty,
  truncate,
  normalizeAddress,
  isValidHex,
  isValidAddress,
  isValidHash,
  normalizeLegacyLogoUrl,
} from '@/lib/utils/format';

describe('formatTokenBalance', () => {
  it('formats raw balances using the given decimals', () => {
    expect(formatTokenBalance('1000000000000000000', 18)).toBe('1.0');
    expect(formatTokenBalance('1500000', 6)).toBe('1.5');
  });

  it('returns "0" on invalid input', () => {
    expect(formatTokenBalance('not-a-number', 18)).toBe('0');
  });
});

describe('formatNumber', () => {
  it('adds thousands separators', () => {
    expect(formatNumber(1234567.89)).toBe('1,234,567.89');
    expect(formatNumber('1000')).toBe('1,000');
  });

  it('returns "0" for NaN input', () => {
    expect(formatNumber('abc')).toBe('0');
  });
});

describe('formatEther', () => {
  it('formats wei to ether', () => {
    expect(formatEther('1000000000000000000')).toBe('1.0');
  });

  it('returns "0" on invalid input', () => {
    expect(formatEther('xyz')).toBe('0');
  });
});

describe('shortenAddress', () => {
  it('shortens long addresses', () => {
    expect(shortenAddress('0x1234567890abcdef1234', 4)).toBe('0x1234...1234');
  });

  it('returns short strings unchanged', () => {
    expect(shortenAddress('0x1234')).toBe('0x1234');
  });
});

describe('timeAgo', () => {
  it('formats seconds', () => {
    expect(timeAgo(new Date(Date.now() - 5_000))).toMatch(/^\d+s ago$/);
  });

  it('formats hours precisely', () => {
    expect(timeAgo(new Date(Date.now() - (3 * 3600 * 1000 + 1000)))).toBe('3h ago');
  });

  it('formats days precisely', () => {
    expect(timeAgo(new Date(Date.now() - (10 * 86400 * 1000 + 1000)))).toBe('10d ago');
  });

  it('formats months and years', () => {
    expect(timeAgo(new Date(Date.now() - 150 * 86400 * 1000))).toMatch(/mo ago$/);
    expect(timeAgo(new Date(Date.now() - 800 * 86400 * 1000))).toMatch(/y ago$/);
  });

  it('treats numeric input as unix seconds', () => {
    expect(timeAgo(Math.floor(Date.now() / 1000) - 7200)).toBe('2h ago');
  });
});

describe('formatPercentage', () => {
  it('formats with the given decimals', () => {
    expect(formatPercentage(12.345, 2)).toBe('12.35%');
  });

  it('returns "0%" for NaN', () => {
    expect(formatPercentage('abc')).toBe('0%');
  });
});

describe('formatHashrate', () => {
  it('scales to the appropriate unit', () => {
    expect(formatHashrate(1500)).toBe('1.50 KH/s');
    expect(formatHashrate(2_500_000)).toBe('2.50 MH/s');
  });

  it('returns "0 H/s" for zero', () => {
    expect(formatHashrate(0)).toBe('0 H/s');
  });
});

describe('formatBytes', () => {
  it('formats byte counts to human readable units', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
  });
});

describe('formatDifficulty', () => {
  it('scales difficulty with SI suffixes', () => {
    expect(formatDifficulty(1500)).toBe('1.50K');
    expect(formatDifficulty(0)).toBe('0');
  });
});

describe('truncate', () => {
  it('truncates strings longer than the limit', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  it('leaves short strings intact', () => {
    expect(truncate('hi', 8)).toBe('hi');
  });
});

describe('normalizeAddress', () => {
  it('lowercases and adds the 0x prefix', () => {
    expect(normalizeAddress('0xABCDEF')).toBe('0xabcdef');
    expect(normalizeAddress('ABCDEF')).toBe('0xabcdef');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeAddress('')).toBe('');
  });
});

describe('hex/address/hash validators', () => {
  it('validates hex strings', () => {
    expect(isValidHex('0x1a2b')).toBe(true);
    expect(isValidHex('1a2b')).toBe(false);
    expect(isValidHex('0xZZ')).toBe(false);
  });

  it('validates addresses and hashes', () => {
    expect(isValidAddress('0x' + 'a'.repeat(40))).toBe(true);
    expect(isValidAddress('0x' + 'a'.repeat(39))).toBe(false);
    expect(isValidHash('0x' + 'b'.repeat(64))).toBe(true);
    expect(isValidHash('0x' + 'b'.repeat(63))).toBe(false);
  });
});

describe('normalizeLegacyLogoUrl', () => {
  it('rewrites legacy explorer host to the current host', () => {
    expect(
      normalizeLegacyLogoUrl(
        'https://explorer.digitalregion.jp/img/STEN.svg',
        'explorer.virbicoin.com'
      )
    ).toBe('https://explorer.virbicoin.com/img/STEN.svg');
  });

  it('leaves non-legacy URLs untouched', () => {
    expect(
      normalizeLegacyLogoUrl('https://explorer.virbicoin.com/img/VBC.svg', 'explorer.virbicoin.com')
    ).toBe('https://explorer.virbicoin.com/img/VBC.svg');
    expect(normalizeLegacyLogoUrl('https://cdn.example.com/a.png', 'explorer.virbicoin.com')).toBe(
      'https://cdn.example.com/a.png'
    );
  });

  it('returns null for empty or nullish input', () => {
    expect(normalizeLegacyLogoUrl(null, 'explorer.virbicoin.com')).toBeNull();
    expect(normalizeLegacyLogoUrl(undefined, 'explorer.virbicoin.com')).toBeNull();
    expect(normalizeLegacyLogoUrl('   ', 'explorer.virbicoin.com')).toBeNull();
  });

  it('returns non-URL strings as-is (e.g. relative paths)', () => {
    expect(normalizeLegacyLogoUrl('/img/STEN.svg', 'explorer.virbicoin.com')).toBe('/img/STEN.svg');
  });

  it('supports a custom legacy host list', () => {
    expect(
      normalizeLegacyLogoUrl('https://old.example.com/a.png', 'new.example.com', [
        'old.example.com',
      ])
    ).toBe('https://new.example.com/a.png');
  });
});
