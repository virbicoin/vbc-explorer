'use client';

import { useState, useEffect } from 'react';

export interface LaunchpadConfig {
  enabled: boolean;
  factoryAddress: string;
  creationFee: string;
  chainId: number;
  rpcUrl: string;
  networkName: string;
  currencySymbol: string;
}

interface ConfigResponse {
  launchpad?: {
    enabled?: boolean;
    factoryAddress?: string;
    creationFee?: string;
  };
  network?: {
    chainId?: number;
    rpcUrl?: string;
    name?: string;
  };
  currency?: {
    symbol?: string;
    name?: string;
  };
}

// Default config values
const defaultConfig: LaunchpadConfig = {
  enabled: false,
  factoryAddress: '0x0000000000000000000000000000000000000000',
  creationFee: '10000000000000000000',
  chainId: 329,
  rpcUrl: 'https://rpc.digitalregion.jp',
  networkName: 'VirBiCoin',
  currencySymbol: 'VBC',
};

// Cache the config
let cachedConfig: LaunchpadConfig | null = null;
let configPromise: Promise<LaunchpadConfig> | null = null;

async function fetchConfig(): Promise<LaunchpadConfig> {
  try {
    const response = await fetch('/api/config/client');
    if (!response.ok) {
      throw new Error('Failed to fetch config');
    }
    const data: ConfigResponse = await response.json();

    return {
      enabled: data.launchpad?.enabled ?? defaultConfig.enabled,
      factoryAddress: data.launchpad?.factoryAddress ?? defaultConfig.factoryAddress,
      creationFee: data.launchpad?.creationFee ?? defaultConfig.creationFee,
      chainId: data.network?.chainId ?? defaultConfig.chainId,
      rpcUrl: data.network?.rpcUrl ?? defaultConfig.rpcUrl,
      networkName: data.network?.name ?? data.currency?.name ?? defaultConfig.networkName,
      currencySymbol: data.currency?.symbol ?? defaultConfig.currencySymbol,
    };
  } catch (error) {
    console.error('[useLaunchpadConfig] Failed to fetch config:', error);
    return defaultConfig;
  }
}

// Helper function to get the factory address
export function getActiveFactoryAddress(config: LaunchpadConfig): string {
  return config.factoryAddress;
}

export function useLaunchpadConfig() {
  const [config, setConfig] = useState<LaunchpadConfig | null>(cachedConfig);
  const [isLoading, setIsLoading] = useState(!cachedConfig);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If we already have cached config, no need to fetch
    if (cachedConfig) {
      return;
    }

    // Reuse existing promise if one is in flight
    if (!configPromise) {
      configPromise = fetchConfig();
    }

    configPromise
      .then((loadedConfig) => {
        cachedConfig = loadedConfig;
        setConfig(loadedConfig);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load config');
        setIsLoading(false);
      });
  }, []);

  // Get active factory address based on config
  const activeFactoryAddress = config ? getActiveFactoryAddress(config) : null;

  return { config, isLoading, error, activeFactoryAddress };
}

// Function to clear the cache (useful for testing or config updates)
export function clearLaunchpadConfigCache() {
  cachedConfig = null;
  configPromise = null;
}
