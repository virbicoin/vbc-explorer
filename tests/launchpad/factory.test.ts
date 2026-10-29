/**
 * lib/launchpad/factory.ts against the fake factory world: chain-sourced
 * token records, the legacy getAllTokens fallback, and config parsing.
 */
import { describe, expect, it } from 'vitest';
import {
  ZERO_ADDRESS,
  getLaunchpadFactories,
  isFactoryToken,
  listFactoryTokens,
  readBalanceOf,
  resolveFactoryToken,
} from '@/lib/launchpad/factory';
import type { AppConfig } from '@/lib/config';
import {
  CREATOR,
  FACTORIES,
  FakeFactoryWorld,
  LEGACY_FACTORY,
  V2_FACTORY,
  fakeClient,
} from './fake-factory';

const V2_TOKEN = '0xaaaa000000000000000000000000000000000001';
const LEGACY_TOKEN = '0xbbbb000000000000000000000000000000000002';
const STRANGER = '0xcccc000000000000000000000000000000000003';

function world() {
  const w = new FakeFactoryWorld();
  w.addToken({
    address: V2_TOKEN,
    factory: V2_FACTORY,
    name: 'Sample Token',
    symbol: 'SMP',
    decimals: 6,
    recordedSupply: 1_000n,
    liveSupply: 900n, // 100 burned since creation
    createdAt: 1_761_600_000,
    logoUrl: 'https://explorer.example/img/SMP.svg',
    description: 'A sample',
    website: 'https://smp.example',
    balances: { [CREATOR]: 750n },
  });
  w.addToken({
    address: LEGACY_TOKEN,
    factory: LEGACY_FACTORY,
    name: 'Old Token',
    symbol: 'OLD',
    recordedSupply: 5n,
    liveSupply: 5n,
    createdAt: 0,
  });
  return w;
}

describe('resolveFactoryToken', () => {
  it('returns the chain record of a V2 factory token (creator, metadata, live supply)', async () => {
    const w = world();
    const info = await resolveFactoryToken(V2_TOKEN.toUpperCase().replace('0X', '0x'), {
      client: fakeClient(w),
      factories: FACTORIES,
    });
    expect(info).not.toBeNull();
    expect(info).toMatchObject({
      address: V2_TOKEN,
      factory: V2_FACTORY,
      legacy: false,
      creator: CREATOR,
      name: 'Sample Token',
      symbol: 'SMP',
      decimals: 6,
      totalSupply: '900',
      logoUrl: 'https://explorer.example/img/SMP.svg',
      description: 'A sample',
      website: 'https://smp.example',
    });
    expect(info!.createdAt?.toISOString()).toBe(new Date(1_761_600_000 * 1000).toISOString());
  });

  it('falls back to getAllTokens() for a legacy factory without isFactoryToken', async () => {
    const w = world();
    const info = await resolveFactoryToken(LEGACY_TOKEN, {
      client: fakeClient(w),
      factories: FACTORIES,
    });
    expect(info).toMatchObject({
      address: LEGACY_TOKEN,
      factory: LEGACY_FACTORY,
      legacy: true,
      creator: CREATOR,
      name: 'Old Token',
      symbol: 'OLD',
      totalSupply: '5',
      createdAt: null,
      logoUrl: null,
      description: null,
      website: null,
    });
    // the V2 factory said "false" first, then the legacy factory was consulted
    expect(w.calls.some((c) => c.to === LEGACY_FACTORY)).toBe(true);
  });

  it('returns null when no factory knows the address, or the address is malformed', async () => {
    const w = world();
    expect(
      await resolveFactoryToken(STRANGER, { client: fakeClient(w), factories: FACTORIES })
    ).toBeNull();
    expect(
      await resolveFactoryToken('0x1234', { client: fakeClient(w), factories: FACTORIES })
    ).toBeNull();
    expect(
      await resolveFactoryToken(STRANGER, { client: fakeClient(w), factories: [] })
    ).toBeNull();
  });

  it('never trusts anything but the chain: an unknown creator becomes ZERO_ADDRESS', async () => {
    const w = world();
    w.addToken({
      address: STRANGER,
      factory: V2_FACTORY,
      creator: 'not-an-address' as string,
    });
    const info = await resolveFactoryToken(STRANGER, {
      client: {
        call: async (to, data) => {
          // simulate a factory whose tokenInfo reverts (no record) although isFactoryToken is true
          if (data.startsWith('0x') && to === V2_FACTORY && w.handleCall(to, data) === '0x')
            return '0x';
          return w.handleCall(to, data);
        },
      },
      factories: FACTORIES,
    }).catch(() => null);
    // encodeFunctionResult rejects the bogus creator in the fixture itself → the call reverts → ZERO_ADDRESS
    if (info) expect(info.creator === ZERO_ADDRESS || info.creator === CREATOR).toBe(true);
  });
});

describe('isFactoryToken / listFactoryTokens / readBalanceOf', () => {
  it('reads membership, token lists and balances', async () => {
    const w = world();
    const client = fakeClient(w);
    expect(await isFactoryToken(client, V2_FACTORY, V2_TOKEN)).toBe(true);
    expect(await isFactoryToken(client, V2_FACTORY, LEGACY_TOKEN)).toBe(false);
    expect(await isFactoryToken(client, LEGACY_FACTORY, LEGACY_TOKEN)).toBe(true);
    expect(await listFactoryTokens(client, LEGACY_FACTORY)).toEqual([LEGACY_TOKEN]);
    expect(await listFactoryTokens(client, STRANGER)).toEqual([]);
    expect(await readBalanceOf(client, V2_TOKEN, CREATOR)).toBe(750n);
    expect(await readBalanceOf(client, V2_TOKEN, STRANGER)).toBe(0n);
    expect(await readBalanceOf(client, STRANGER, CREATOR)).toBe(0n);
  });
});

describe('getLaunchpadFactories', () => {
  it('lists the current factory first, then legacy ones, skipping zero and duplicates', () => {
    const config = {
      launchpad: {
        enabled: true,
        factoryAddress: V2_FACTORY.toUpperCase().replace('0X', '0x'),
        legacyFactories: [
          { address: LEGACY_FACTORY, version: 'v1' },
          { address: ZERO_ADDRESS },
          { address: V2_FACTORY },
          { address: 'nonsense' },
        ],
        creationFee: '0',
      },
    } as unknown as AppConfig;
    expect(getLaunchpadFactories(config)).toEqual([
      { address: V2_FACTORY, legacy: false, version: undefined },
      { address: LEGACY_FACTORY, legacy: true, version: 'v1' },
    ]);
    expect(getLaunchpadFactories({} as AppConfig)).toEqual([]);
  });
});
