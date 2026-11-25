/**
 * The native coin's USD price read from a DEX pool (wrapped native coin
 * against a stablecoin). Used by tools/price.ts.
 */
import { ethers } from 'ethers';

/**
 * The view functions the price is read with.
 *
 * `getReserves` is declared with two return values. The pairs of this DEX
 * answer with two words (reserve0, reserve1); a Uniswap V2 pair answers with a
 * third word (blockTimestampLast), which a two-value declaration decodes just
 * as well. Declared the Uniswap way, with three values, the call fails on a
 * two-word answer, so no price could ever be read from these pairs.
 */
export const PAIR_VIEW_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint256 reserve0, uint256 reserve1)',
];

/** A pair's tokens (lowercase addresses), their decimals and its reserves. */
export interface PairSnapshot {
  token0: string;
  token1: string;
  decimals0: number;
  decimals1: number;
  reserve0: bigint;
  reserve1: bigint;
}

const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

/**
 * An address from the configuration, lowercase; undefined when it is missing,
 * not an address, or the zero address the example configuration ships with.
 */
export function configuredAddress(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) return undefined;
  const address = value.toLowerCase();
  return address === ZERO_ADDRESS ? undefined : address;
}

/** Whether the pair trades the wrapped native coin against the stablecoin. */
export function isNativeStablePair(
  pair: Pick<PairSnapshot, 'token0' | 'token1'>,
  wrappedNative: string,
  stablecoin: string
): boolean {
  const native = wrappedNative.toLowerCase();
  const stable = stablecoin.toLowerCase();
  if (native === stable) return false;
  return (
    (pair.token0 === native && pair.token1 === stable) ||
    (pair.token0 === stable && pair.token1 === native)
  );
}

/**
 * USD price of one native coin from the pair's reserves (stablecoin reserve
 * divided by wrapped native reserve, each in whole units). Null when the pair
 * is not the wrapped native / stablecoin pair or holds no liquidity, so an
 * empty pool is never stored as a price of zero or infinity.
 */
export function nativePriceFromReserves(
  pair: PairSnapshot,
  wrappedNative: string,
  stablecoin: string
): number | null {
  if (!isNativeStablePair(pair, wrappedNative, stablecoin)) return null;
  if (pair.reserve0 <= 0n || pair.reserve1 <= 0n) return null;

  const amount0 = Number(ethers.formatUnits(pair.reserve0, pair.decimals0));
  const amount1 = Number(ethers.formatUnits(pair.reserve1, pair.decimals1));
  const stableIsToken0 = pair.token0 === stablecoin.toLowerCase();
  const price = stableIsToken0 ? amount0 / amount1 : amount1 / amount0;
  return Number.isFinite(price) && price > 0 ? price : null;
}
