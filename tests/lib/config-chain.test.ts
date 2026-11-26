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
