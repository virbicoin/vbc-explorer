/**
 * lib/dex/priceUtils.ts: the DEX addresses come from config.json, not from constants.
 */
import { describe, expect, it } from 'vitest';
import { dexAddresses } from '@/lib/dex/priceUtils';

const A = (n: number) => '0x' + n.toString(16).padStart(40, '0');

const config = {
  dex: {
    factory: A(1),
    router: A(2),
    masterChef: A(3), // a string, as in production
    wrappedNative: { address: A(4), symbol: 'WNAT' },
    rewardToken: { address: A(5), symbol: 'GOV' },
    tokens: { usdt: { address: A(6), symbol: 'USDT' } },
    lpTokens: {
      govWnat: { address: A(7), token0: 'GOV', token1: 'WNAT' },
      usdtWnat: { address: A(8), token0: 'USDT', token1: 'WNAT' },
    },
  },
};

describe('dexAddresses', () => {
  it('reads every address from the configuration', () => {
    expect(dexAddresses(config)).toMatchObject({
      FACTORY: A(1),
      ROUTER: A(2),
      MASTERCHEF: A(3),
      WRAPPED_NATIVE: A(4),
      SECONDARY: A(5),
      STABLECOIN: A(6),
      NATIVE_SECONDARY_PAIR: A(7),
      NATIVE_STABLECOIN_PAIR: A(8),
      WVBC: A(4),
      USDT_VBC_PAIR: A(8),
    });
  });

  it('prefers the explicit price settings and accepts masterChef as an object', () => {
    const addresses = dexAddresses({
      ...config,
      dex: { ...config.dex, masterChef: { address: A(9) } },
      currency: { priceApi: { dex: { pairAddress: A(10), stablecoinAddress: A(11) } } },
    });
    expect(addresses).toMatchObject({
      MASTERCHEF: A(9),
      NATIVE_STABLECOIN_PAIR: A(10),
      STABLECOIN: A(11),
    });
  });

  it('leaves what is not configured empty instead of using another chain contract', () => {
    expect(dexAddresses({})).toMatchObject({
      FACTORY: '',
      MASTERCHEF: '',
      WRAPPED_NATIVE: '',
      NATIVE_STABLECOIN_PAIR: '',
    });
  });
});
