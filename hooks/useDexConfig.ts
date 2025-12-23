// Hook to fetch DEX configuration dynamically
'use client';

import { useState, useEffect, useCallback } from 'react';

export interface TokenInfo {
  address: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
}

export interface PoolInfo {
  pid: number;
  lpToken: `0x${string}`;
  allocPoint: number;
  token0: TokenInfo;
  token1: TokenInfo;
}

export interface DexConfigData {
  network: {
    chainId: number;
    rpcUrl: string;
    explorer: string;
  };
  contracts: {
    router: `0x${string}`;
    factory: `0x${string}`;
    wvbc: `0x${string}`;
    masterChef: `0x${string}`;
  };
  rewardToken: TokenInfo;
  farming: {
    rewardPerBlock: string;
    rewardPerBlockFormatted: string;
    pools: PoolInfo[];
  };
  tokens: {
    native: TokenInfo;
    wvbc: TokenInfo;
    reward: TokenInfo;
  };
  lastUpdated: number;
}

interface UseDexConfigResult {
  config: DexConfigData | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// Cache for client-side
let clientCache: DexConfigData | null = null;
let clientCacheTimestamp = 0;
const CLIENT_CACHE_TTL = 30 * 1000; // 30 seconds

export function useDexConfig(): UseDexConfigResult {
  const [config, setConfig] = useState<DexConfigData | null>(clientCache);
  const [isLoading, setIsLoading] = useState(!clientCache);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async (forceRefresh = false) => {
    // Return cached if valid and not forcing refresh
    if (!forceRefresh && clientCache && Date.now() - clientCacheTimestamp < CLIENT_CACHE_TTL) {
      setConfig(clientCache);
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const url = forceRefresh ? '/api/dex/config?refresh=true' : '/api/dex/config';
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch config');
      }
      
      clientCache = result.data;
      clientCacheTimestamp = Date.now();
      setConfig(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch DEX config');
      console.error('Error fetching DEX config:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const refresh = useCallback(async () => {
    await fetchConfig(true);
  }, [fetchConfig]);

  return { config, isLoading, error, refresh };
}

// Helper to get contracts from config
export function getContracts(config: DexConfigData | null) {
  if (!config) return null;
  return config.contracts;
}

// Helper to get reward info from config  
export function getRewardInfo(config: DexConfigData | null) {
  if (!config) return null;
  return {
    token: config.rewardToken,
    perBlock: config.farming.rewardPerBlockFormatted,
  };
}
