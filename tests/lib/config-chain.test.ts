/**
 * Chain facts come from config.json: the helpers fall back to Ethereum, never to the chain this
 * explorer was first written for.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearConfigCache,
  getChainId,
  getCompilerConfig,
  getNetworkName,
  getNetworkSlug,
  getRewardSchedule,
  getWrappedNativeSymbol,
  mergeDexSettings,
  readConfig,
  setChainSettings,
} from '@/lib/config';
import { formatCoins } from '@/lib/reward-schedule';

const dirs: string[] = [];

/** Points readConfig() at a directory holding `config` as config.json. */
function useConfig(config: object | null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explorer-config-'));
  dirs.push(dir);
  if (config) fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  clearConfigCache();
}

afterEach(() => {
  vi.restoreAllMocks();
  clearConfigCache();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('chain facts from config.json', () => {
  it('reads the configured network, currency and wrapped token', () => {
    useConfig({
      network: { name: 'Ethereum Classic', chainId: 61 },
      currency: { symbol: 'ETC' },
      rewards: { blockReward: { '0': '5', '5000001': '4' }, flatUncleRewardFrom: 5000001 },
      compiler: { defaultEvmVersion: 'paris' },
    });
    expect(getNetworkName()).toBe('Ethereum Classic');
    expect(getNetworkSlug()).toBe('ethereum-classic');
    expect(getChainId()).toBe(61);
    expect(getWrappedNativeSymbol()).toBe('WETC');
    expect(formatCoins(getRewardSchedule().steps[1].reward)).toBe('4');
    expect(getRewardSchedule().flatUncleRewardFrom).toBe(5000001);
    expect(getCompilerConfig().defaultEvmVersion).toBe('paris');
  });

  it('prefers an explicit slug and wrapped token symbol', () => {
    useConfig({
      network: { name: 'Some Fork', slug: 'somefork' },
      dex: { wrappedNative: { symbol: 'WSF' } },
    });
    expect(getNetworkSlug()).toBe('somefork');
    expect(getWrappedNativeSymbol()).toBe('WSF');
  });

  it("falls back to Ethereum's values without a config file", () => {
    useConfig(null);
    expect(getNetworkName()).toMatch(/^Ethereum/);
    expect(getNetworkSlug()).toMatch(/^ethereum/);
    expect(getChainId()).toBe(1);
    expect(getWrappedNativeSymbol()).toBe('WETH');
    expect(getRewardSchedule().steps.map((step) => formatCoins(step.reward))).toEqual([
      '5',
      '3',
      '2',
      '0',
    ]);
    expect(getCompilerConfig().defaultEvmVersion).toBeNull();
  });
});

describe('mergeDexSettings', () => {
  const chain = {
    factory: '0xfac' as `0x${string}`,
    wrappedNative: {
      address: '0xw' as `0x${string}`,
      name: 'Wrapped',
      symbol: 'WCOIN',
      decimals: 18,
    },
    tokens: {
      usdt: { address: '0xu' as `0x${string}`, name: 'Tether', symbol: 'USDT', decimals: 6 },
      gold: { address: '0xg' as `0x${string}`, name: 'Gold', symbol: 'GOLD', decimals: 18 },
    },
    lpTokens: {
      goldWcoin: {
        address: '0xp' as `0x${string}`,
        name: 'GOLD-WCOIN LP',
        symbol: 'GOLD-WCOIN LP',
        token0: 'GOLD',
        token1: 'WCOIN',
      },
    },
    farmPools: [
      {
        pid: 0,
        name: 'GOLD-WCOIN LP',
        lpToken: '0xp' as `0x${string}`,
        token0Symbol: 'GOLD',
        token1Symbol: 'WCOIN',
      },
    ],
  };

  it('fills what config.json leaves out from the chain', () => {
    const merged = mergeDexSettings({ enabled: true, router: '0xr' }, chain);
    expect(merged).toMatchObject({ enabled: true, router: '0xr', factory: '0xfac' });
    expect(merged.wrappedNative?.symbol).toBe('WCOIN');
    expect(Object.keys(merged.tokens ?? {})).toEqual(['usdt', 'gold']);
    expect(merged.farmPools).toHaveLength(1);
  });

  it('uses every setting written in config.json as written', () => {
    const merged = mergeDexSettings(
      {
        enabled: true,
        factory: '0xmine',
        tokens: { usdt: { address: '0xmyusdt', name: 'My USD', symbol: 'USDT', decimals: 6 } },
        farmPools: [],
      },
      chain
    );
    expect(merged.factory).toBe('0xmine');
    // a written list is the whole list: no tokens or pairs are added to it
    expect(merged.tokens).toEqual({
      usdt: { address: '0xmyusdt', name: 'My USD', symbol: 'USDT', decimals: 6 },
    });
    expect(merged.farmPools).toEqual([]);
    expect(merged.lpTokens).toBe(chain.lpTokens);
  });

  it('cannot be overwritten by one job for the others of the worker', () => {
    useConfig({ dex: { enabled: true, router: '0xr' } });
    setChainSettings({ dex: chain });
    try {
      expect(readConfig().dex?.factory).toBe('0xfac');
      // the sync job used to copy the raw config.json over the shared object
      expect(() => Object.assign(readConfig(), { dex: { enabled: true, router: '0xr' } })).toThrow(
        TypeError
      );
      expect(readConfig().dex?.factory).toBe('0xfac');
    } finally {
      setChainSettings({});
    }
  });
});
