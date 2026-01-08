'use client';

import { useState, useEffect } from 'react';

export interface AlternativePaymentToken {
  address: string;
  symbol: string;
  decimals: number;
}

export interface AlternativePaymentContractFunctions {
  getFeeInfo: string;
  createToken: string;
  createTokenWithMetadata: string;
}

export interface AlternativePayment {
  enabled: boolean;
  token: AlternativePaymentToken;
  fee: string;
  discountLabel: string;
  burnNote: string;
  contractFunctions: AlternativePaymentContractFunctions;
}

export interface LegacyFactory {
  address: string;
  version?: string;
  note?: string;
}

export interface LaunchpadConfig {
  enabled: boolean;
  factoryAddress: string;
  legacyFactories: LegacyFactory[];
  creationFee: string;
  alternativePayment: AlternativePayment | null;
  chainId: number;
  rpcUrl: string;
  networkName: string;
  currencySymbol: string;
}

interface ConfigResponse {
  launchpad?: {
    enabled?: boolean;
    factoryAddress?: string;
    legacyFactories?: { address?: string; version?: string; note?: string }[];
    creationFee?: string;
    alternativePayment?: {
      enabled?: boolean;
      token?: {
        address?: string;
        symbol?: string;
        decimals?: number;
      };
      fee?: string;
      discountLabel?: string;
      burnNote?: string;
      contractFunctions?: {
        getFeeInfo?: string;
        createToken?: string;
        createTokenWithMetadata?: string;
      };
    };
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

// Default config values (generic fallbacks)
const defaultConfig: LaunchpadConfig = {
  enabled: false,
  factoryAddress: '0x0000000000000000000000000000000000000000',
  legacyFactories: [],
  creationFee: '10000000000000000000',
  alternativePayment: null,
  chainId: 1,
  rpcUrl: 'http://localhost:8545',
  networkName: 'Network',
  currencySymbol: 'NATIVE',
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

    // Parse alternative payment config
    let alternativePayment: AlternativePayment | null = null;
    if (
      data.launchpad?.alternativePayment?.enabled &&
      data.launchpad?.alternativePayment?.token?.address
    ) {
      const altConfig = data.launchpad.alternativePayment;
      alternativePayment = {
        enabled: true,
        token: {
          address: altConfig.token!.address!,
          symbol: altConfig.token?.symbol || 'TOKEN',
          decimals: altConfig.token?.decimals || 18,
        },
        fee: altConfig.fee || '0',
        discountLabel: altConfig.discountLabel || '',
        burnNote: altConfig.burnNote || '',
        contractFunctions: {
          getFeeInfo: altConfig.contractFunctions?.getFeeInfo || 'getAlternativeFeeInfo',
          createToken: altConfig.contractFunctions?.createToken || 'createTokenWithAlternative',
          createTokenWithMetadata:
            altConfig.contractFunctions?.createTokenWithMetadata ||
            'createTokenWithAlternativeAndMetadata',
        },
      };
    }

    // Parse legacy factories
    const legacyFactories: LegacyFactory[] = (data.launchpad?.legacyFactories || [])
      .filter((f) => f.address && f.address !== '0x0000000000000000000000000000000000000000')
      .map((f) => ({
        address: f.address!,
        version: f.version,
        note: f.note,
      }));

    return {
      enabled: data.launchpad?.enabled ?? defaultConfig.enabled,
      factoryAddress: data.launchpad?.factoryAddress ?? defaultConfig.factoryAddress,
      legacyFactories,
      creationFee: data.launchpad?.creationFee ?? defaultConfig.creationFee,
      alternativePayment,
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
