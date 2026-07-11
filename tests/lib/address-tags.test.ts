import { describe, it, expect } from 'vitest';
import { buildAddressTags } from '@/lib/address-tags';

const A = (n: number) => `0x${String(n).padStart(40, '0')}`;

describe('buildAddressTags', () => {
  it('returns empty map for empty config', () => {
    expect(buildAddressTags({})).toEqual({});
  });

  it('tags DEX infrastructure addresses', () => {
    const tags = buildAddressTags({
      dex: {
        factory: A(1),
        router: A(2),
        masterChef: A(3),
        wrappedNative: { address: A(4), name: 'Wrapped Coin', symbol: 'WCOIN' },
        rewardToken: { address: A(5), name: 'Reward', symbol: 'RWD' },
      },
    });
    expect(tags[A(1)]).toBe('DEX: Factory');
    expect(tags[A(2)]).toBe('DEX: Router');
    expect(tags[A(3)]).toBe('DEX: MasterChef');
    expect(tags[A(4)]).toBe('Wrapped Coin (WCOIN)');
    expect(tags[A(5)]).toBe('Reward (RWD)');
  });

  it('tags launchpad factories including legacy ones', () => {
    const tags = buildAddressTags({
      launchpad: {
        factoryAddress: A(6),
        legacyFactories: [{ address: A(7) }, {}],
      },
    });
    expect(tags[A(6)]).toBe('Launchpad: Token Factory');
    expect(tags[A(7)]).toBe('Launchpad: Token Factory (legacy)');
  });

  it('tags bridge vaults and lock-and-swap contracts per route', () => {
    const tags = buildAddressTags({
      bridge: {
        routes: [{ id: 'native-bsc', vault: A(8), autoSwap: { lockAndSwap: A(9) } }],
      },
    });
    expect(tags[A(8)]).toBe('Bridge: Vault (native-bsc)');
    expect(tags[A(9)]).toBe('Bridge: Lock & Swap (native-bsc)');
  });

  it('includes miners and knownTokens labels', () => {
    const tags = buildAddressTags({
      miners: { [A(10)]: 'Example Pool' },
      knownTokens: { [A(11)]: { name: 'My Token', symbol: 'MTK' } },
    });
    expect(tags[A(10)]).toBe('Example Pool');
    expect(tags[A(11)]).toBe('My Token (MTK)');
  });

  it('skips the zero address and invalid addresses', () => {
    const tags = buildAddressTags({
      dex: { factory: '0x0000000000000000000000000000000000000000', router: 'not-an-address' },
    });
    expect(Object.keys(tags)).toHaveLength(0);
  });

  it('lowercases mixed-case addresses', () => {
    const mixed = '0xAbCdEf0000000000000000000000000000000001';
    const tags = buildAddressTags({ addressTags: { [mixed]: 'Treasury' } });
    expect(tags[mixed.toLowerCase()]).toBe('Treasury');
  });

  it('manual addressTags override derived labels', () => {
    const tags = buildAddressTags({
      dex: { router: A(12) },
      addressTags: { [A(12)]: 'Custom Router Label' },
    });
    expect(tags[A(12)]).toBe('Custom Router Label');
  });
});
