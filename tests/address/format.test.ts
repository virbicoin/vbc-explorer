import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatAddress,
  formatTimestamp,
  getTimeAgo,
  formatNativeValueShort,
  formatNativeValueDetailed,
  parseDate,
  formatTokenBalance,
} from '@/lib/address/format';

const ZERO = '0x0000000000000000000000000000000000000000';
const ADDR = '0x1234567890abcdef1234567890abcdef12345678';

afterEach(() => {
  vi.useRealTimers();
});

describe('formatAddress', () => {
  it('shortens an address to head...tail', () => {
    expect(formatAddress(ADDR)).toBe('0x123456...345678');
  });

  it('returns N/A for empty input', () => {
    expect(formatAddress('')).toBe('N/A');
  });

  it('maps the zero address to System only when requested', () => {
    expect(formatAddress(ZERO, true)).toBe('System');
    expect(formatAddress(ZERO)).toBe('0x000000...000000');
  });
});

describe('formatTimestamp', () => {
  it('converts unix seconds to a non-empty locale string', () => {
    const out = formatTimestamp(1_700_000_000);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('getTimeAgo', () => {
  it('formats seconds/minutes/hours/days relative to now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const now = Math.floor(Date.now() / 1000);

    expect(getTimeAgo(now - 5)).toBe('5s ago');
    expect(getTimeAgo(now - 120)).toBe('2m ago');
    expect(getTimeAgo(now - 3 * 3600)).toBe('3h ago');
    expect(getTimeAgo(now - 2 * 86400)).toBe('2d ago');
  });
});

describe('formatNativeValueShort', () => {
  it('formats zero and whole values', () => {
    expect(formatNativeValueShort('0', 'VBC')).toBe('0 VBC');
    expect(formatNativeValueShort((10n ** 18n).toString(), 'VBC')).toBe('1.0000 VBC');
  });

  it('uses the small-value threshold', () => {
    expect(formatNativeValueShort('1', 'VBC')).toBe('<0.000001 VBC');
  });

  it('falls back to raw value on invalid input', () => {
    expect(formatNativeValueShort('abc', 'VBC')).toBe('abc VBC');
  });
});

describe('formatNativeValueDetailed', () => {
  it('uses graduated tiers', () => {
    expect(formatNativeValueDetailed('0', 'VBC')).toBe('0 VBC');
    // 0.5 -> sub-1 tier with 6 decimals
    expect(formatNativeValueDetailed((5n * 10n ** 17n).toString(), 'VBC')).toBe('0.500000 VBC');
    // 1 -> sub-1000 tier with 4 decimals
    expect(formatNativeValueDetailed((10n ** 18n).toString(), 'VBC')).toBe('1.0000 VBC');
  });

  it('falls back to raw value on invalid input', () => {
    expect(formatNativeValueDetailed('xyz', 'VBC')).toBe('xyz VBC');
  });
});

describe('parseDate', () => {
  it('parses a valid date string', () => {
    expect(parseDate('2026-01-01T00:00:00Z')).toBeInstanceOf(Date);
  });

  it('returns null for empty or invalid input', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('Invalid Date')).toBeNull();
    expect(parseDate('not-a-date')).toBeNull();
  });
});

describe('formatTokenBalance', () => {
  it('formats whole balances with thousands separators', () => {
    expect(formatTokenBalance((1000n * 10n ** 18n).toString(), 18, 'TKN')).toBe('1,000 TKN');
  });

  it('formats fractional balances, trimming trailing zeros', () => {
    expect(formatTokenBalance((15n * 10n ** 17n).toString(), 18, 'TKN')).toBe('1.5 TKN');
  });

  it('falls back to raw balance on invalid input', () => {
    expect(formatTokenBalance('abc', 18, 'TKN')).toBe('abc TKN');
  });
});
