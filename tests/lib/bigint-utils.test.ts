import { describe, it, expect } from 'vitest';
import {
  baseToCurrency,
  baseToGasUnit,
  formatCurrency,
  formatGasUnit,
  weiToVBC,
  weiToGwei,
} from '@/lib/bigint-utils';

// Note: without calling initializeCurrency(), the module uses its defaults:
//   18 decimals, currency symbol 'ETH', gas unit 'Gwei'.

describe('baseToCurrency', () => {
  it('returns "0" for zero', () => {
    expect(baseToCurrency('0')).toBe('0');
    expect(baseToCurrency(0n)).toBe('0');
  });

  it('converts whole units exactly', () => {
    expect(baseToCurrency('1000000000000000000')).toBe('1');
    expect(baseToCurrency(2n * 10n ** 18n)).toBe('2');
  });

  it('converts fractional units and strips trailing zeros', () => {
    expect(baseToCurrency('1500000000000000000')).toBe('1.5');
    expect(baseToCurrency('100000000000000000')).toBe('0.1');
  });

  it('keeps full precision for the smallest unit', () => {
    expect(baseToCurrency('1')).toBe('0.000000000000000001');
  });

  it('returns "0" on invalid input instead of throwing', () => {
    expect(baseToCurrency('not-a-number')).toBe('0');
  });
});

describe('baseToGasUnit', () => {
  it('returns "0" for zero', () => {
    expect(baseToGasUnit('0')).toBe('0');
  });

  it('converts whole gwei exactly', () => {
    expect(baseToGasUnit('1000000000')).toBe('1');
    expect(baseToGasUnit('20000000000')).toBe('20');
  });

  it('converts fractional gwei and strips trailing zeros', () => {
    expect(baseToGasUnit('1500000000')).toBe('1.5');
  });
});

describe('formatCurrency', () => {
  it('formats zero with the currency symbol', () => {
    expect(formatCurrency('0')).toBe('0 ETH');
  });

  it('formats values >= 1 with up to 4 decimals', () => {
    expect(formatCurrency('1.5')).toBe('1.5 ETH');
    expect(formatCurrency('1234.5678')).toBe('1234.57 ETH');
  });

  it('formats sub-1 values with up to 6 decimals', () => {
    expect(formatCurrency('0.5')).toBe('0.5 ETH');
  });
});

describe('formatGasUnit', () => {
  it('floors the value and appends the gas unit', () => {
    expect(formatGasUnit('1.7')).toBe('1 Gwei');
    expect(formatGasUnit('25')).toBe('25 Gwei');
  });
});

describe('backward-compatible aliases', () => {
  it('weiToVBC matches baseToCurrency', () => {
    expect(weiToVBC('1000000000000000000')).toBe(baseToCurrency('1000000000000000000'));
  });

  it('weiToGwei matches baseToGasUnit', () => {
    expect(weiToGwei('1000000000')).toBe(baseToGasUnit('1000000000'));
  });
});
