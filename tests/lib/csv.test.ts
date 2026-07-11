import { describe, it, expect } from 'vitest';
import {
  csvEscape,
  csvLine,
  buildCsv,
  formatUnitsExact,
  formatCsvDateTime,
  computeTxFee,
} from '@/lib/utils/csv';

describe('csvEscape', () => {
  it('quotes plain values', () => {
    expect(csvEscape('hello')).toBe('"hello"');
    expect(csvEscape(123)).toBe('"123"');
  });

  it('doubles inner quotes', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it('returns empty quotes for null/undefined', () => {
    expect(csvEscape(null)).toBe('""');
    expect(csvEscape(undefined)).toBe('""');
  });

  it('guards against formula injection', () => {
    expect(csvEscape('=SUM(A1)')).toBe('"\'=SUM(A1)"');
    expect(csvEscape('+123')).toBe('"\'+123"');
    expect(csvEscape('-cmd')).toBe('"\'-cmd"');
    expect(csvEscape('@import')).toBe('"\'@import"');
  });

  it('leaves hex addresses untouched', () => {
    expect(csvEscape('0xAbC123')).toBe('"0xAbC123"');
  });
});

describe('csvLine', () => {
  it('joins fields with comma and CRLF', () => {
    expect(csvLine(['a', 1, null])).toBe('"a","1",""\r\n');
  });
});

describe('buildCsv', () => {
  it('prepends BOM and header row', () => {
    const csv = buildCsv(['H1', 'H2'], [['a', 'b']]);
    expect(csv.startsWith('\uFEFF"H1","H2"\r\n')).toBe(true);
    expect(csv).toContain('"a","b"\r\n');
  });
});

describe('formatUnitsExact', () => {
  it('formats 18-decimal wei values', () => {
    expect(formatUnitsExact('1000000000000000000', 18)).toBe('1');
    expect(formatUnitsExact('1500000000000000000', 18)).toBe('1.5');
    expect(formatUnitsExact('1', 18)).toBe('0.000000000000000001');
  });

  it('trims trailing zeros in the fraction', () => {
    expect(formatUnitsExact('1230000000000000000', 18)).toBe('1.23');
  });

  it('handles zero decimals', () => {
    expect(formatUnitsExact('42', 0)).toBe('42');
  });

  it('handles huge values without precision loss', () => {
    expect(formatUnitsExact('123456789012345678901234567890', 18)).toBe(
      '123456789012.34567890123456789'
    );
  });

  it('returns 0 for invalid input', () => {
    expect(formatUnitsExact('', 18)).toBe('0');
    expect(formatUnitsExact('abc', 18)).toBe('0');
    expect(formatUnitsExact(null, 18)).toBe('0');
    expect(formatUnitsExact('0x123', 18)).toBe('0');
  });

  it('falls back to 18 decimals for out-of-range decimals', () => {
    expect(formatUnitsExact('1000000000000000000', -5)).toBe('1');
    expect(formatUnitsExact('1000000000000000000', 999)).toBe('1');
  });
});

describe('formatCsvDateTime', () => {
  it('formats unix seconds as UTC datetime', () => {
    expect(formatCsvDateTime(1700000000)).toBe('2023-11-14 22:13:20');
  });

  it('returns empty string for missing timestamps', () => {
    expect(formatCsvDateTime(null)).toBe('');
    expect(formatCsvDateTime(0)).toBe('');
    expect(formatCsvDateTime(NaN)).toBe('');
  });
});

describe('computeTxFee', () => {
  it('multiplies gasUsed by gasPrice and formats to native units', () => {
    // 21000 gas * 20 gwei = 0.00042
    expect(computeTxFee(21000, '20000000000')).toBe('0.00042');
  });

  it('returns 0 for missing inputs', () => {
    expect(computeTxFee(null, '1')).toBe('0');
    expect(computeTxFee(21000, null)).toBe('0');
    expect(computeTxFee(21000, 'not-a-number')).toBe('0');
  });
});
