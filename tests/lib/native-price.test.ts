/**
 * The native coin's USD price from a DEX pool: decoding the pair's answer and
 * the price arithmetic.
 */
import { describe, expect, it } from 'vitest';
import { ethers } from 'ethers';
import {
  PAIR_VIEW_ABI,
  configuredAddress,
  isNativeStablePair,
  nativePriceFromReserves,
  type PairSnapshot,
} from '@/lib/dex/native-price';

const WRAPPED = `0x${'aa'.repeat(20)}`;
const STABLE = `0x${'bb'.repeat(20)}`;
const OTHER = `0x${'cc'.repeat(20)}`;

const word = (value: bigint) => value.toString(16).padStart(64, '0');

// 279,500 wrapped coins (18 decimals) against 226.25 stablecoins (6 decimals)
const NATIVE_RESERVE = 279_500n * 10n ** 18n;
const STABLE_RESERVE = 226_250_000n;

const pair = (overrides: Partial<PairSnapshot> = {}): PairSnapshot => ({
  token0: WRAPPED,
  token1: STABLE,
  decimals0: 18,
  decimals1: 6,
  reserve0: NATIVE_RESERVE,
  reserve1: STABLE_RESERVE,
  ...overrides,
});

describe('PAIR_VIEW_ABI', () => {
  const pairInterface = new ethers.Interface(PAIR_VIEW_ABI);

  it('decodes the two-word answer of the pairs of this DEX', () => {
    const answer = `0x${word(NATIVE_RESERVE)}${word(STABLE_RESERVE)}`;
    const [reserve0, reserve1] = pairInterface.decodeFunctionResult('getReserves', answer);
    expect(reserve0).toBe(NATIVE_RESERVE);
    expect(reserve1).toBe(STABLE_RESERVE);
  });

  it('decodes the three-word answer of a Uniswap V2 pair', () => {
    const answer = `0x${word(NATIVE_RESERVE)}${word(STABLE_RESERVE)}${word(1_760_000_000n)}`;
    const [reserve0, reserve1] = pairInterface.decodeFunctionResult('getReserves', answer);
    expect(reserve0).toBe(NATIVE_RESERVE);
    expect(reserve1).toBe(STABLE_RESERVE);
  });

  it('is the declaration a three-value one cannot replace', () => {
    const uniswap = new ethers.Interface([
      'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    ]);
    const answer = `0x${word(NATIVE_RESERVE)}${word(STABLE_RESERVE)}`;
    expect(() => uniswap.decodeFunctionResult('getReserves', answer)).toThrow();
  });
});

describe('nativePriceFromReserves', () => {
  const expected = 226.25 / 279_500;

  it('divides the stablecoin reserve by the wrapped native reserve', () => {
    expect(nativePriceFromReserves(pair(), WRAPPED, STABLE)).toBeCloseTo(expected, 12);
  });

  it('gives the same price when the stablecoin is token0', () => {
    const reversed = pair({
      token0: STABLE,
      token1: WRAPPED,
      decimals0: 6,
      decimals1: 18,
      reserve0: STABLE_RESERVE,
      reserve1: NATIVE_RESERVE,
    });
    expect(nativePriceFromReserves(reversed, WRAPPED, STABLE)).toBeCloseTo(expected, 12);
  });

  it('accepts configured addresses in any letter case', () => {
    const price = nativePriceFromReserves(
      pair(),
      WRAPPED.toUpperCase().replace('0X', '0x'),
      STABLE
    );
    expect(price).toBeCloseTo(expected, 12);
  });

  it('returns null for a pool without liquidity', () => {
    expect(nativePriceFromReserves(pair({ reserve0: 0n }), WRAPPED, STABLE)).toBeNull();
    expect(nativePriceFromReserves(pair({ reserve1: 0n }), WRAPPED, STABLE)).toBeNull();
    expect(
      nativePriceFromReserves(pair({ reserve0: 0n, reserve1: 0n }), WRAPPED, STABLE)
    ).toBeNull();
  });

  it('returns null for a pair of other tokens', () => {
    expect(nativePriceFromReserves(pair({ token1: OTHER }), WRAPPED, STABLE)).toBeNull();
    expect(nativePriceFromReserves(pair({ token0: OTHER }), WRAPPED, STABLE)).toBeNull();
  });
});

describe('isNativeStablePair', () => {
  it('matches the pair in either token order', () => {
    expect(isNativeStablePair({ token0: WRAPPED, token1: STABLE }, WRAPPED, STABLE)).toBe(true);
    expect(isNativeStablePair({ token0: STABLE, token1: WRAPPED }, WRAPPED, STABLE)).toBe(true);
    expect(isNativeStablePair({ token0: WRAPPED, token1: OTHER }, WRAPPED, STABLE)).toBe(false);
  });

  it('does not match when both configured addresses are the same', () => {
    expect(isNativeStablePair({ token0: WRAPPED, token1: WRAPPED }, WRAPPED, WRAPPED)).toBe(false);
  });
});

describe('configuredAddress', () => {
  it('returns the address in lowercase', () => {
    expect(configuredAddress(`0x${'AB'.repeat(20)}`)).toBe(`0x${'ab'.repeat(20)}`);
  });

  it('treats the zero address of the example configuration as not configured', () => {
    expect(configuredAddress(`0x${'0'.repeat(40)}`)).toBeUndefined();
  });

  it('returns undefined for anything that is not an address', () => {
    expect(configuredAddress(undefined)).toBeUndefined();
    expect(configuredAddress('')).toBeUndefined();
    expect(configuredAddress('0x1234')).toBeUndefined();
    expect(configuredAddress(42)).toBeUndefined();
  });
});
