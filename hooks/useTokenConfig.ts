// Hook to fetch token configuration (icons, colors, symbols) from config.json
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

// Token icon/color configuration
export interface TokenIconConfig {
  symbol: string;
  name?: string;
  icon: string | null;
  color: string;
}

export interface TokenConfigData {
  native: TokenIconConfig;
  wrapped: TokenIconConfig;
  reward: TokenIconConfig | null;
}

interface UseTokenConfigResult {
  config: TokenConfigData | null;
  isLoading: boolean;
  error: string | null;
  getTokenIcon: (symbol: string) => string | null;
  getTokenColor: (symbol: string) => string;
  displaySymbol: (symbol: string) => string;
}

// Default fallback colors
const DEFAULT_COLOR = 'from-gray-500 to-gray-600';

// Cache for client-side
let clientCache: TokenConfigData | null = null;
let clientCacheTimestamp = 0;
const CLIENT_CACHE_TTL = 60 * 1000; // 60 seconds

export function useTokenConfig(): UseTokenConfigResult {
  const [config, setConfig] = useState<TokenConfigData | null>(clientCache);
  const [isLoading, setIsLoading] = useState(!clientCache);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    // Return cached if valid
    if (clientCache && Date.now() - clientCacheTimestamp < CLIENT_CACHE_TTL) {
      setConfig(clientCache);
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/config/client');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Build token config from API response
      const tokenConfig: TokenConfigData = {
        native: {
          symbol: data.currency?.symbol || 'ETH',
          name: data.currency?.name || 'Ether',
          icon: data.currency?.icon || null,
          color: data.currency?.color || DEFAULT_COLOR,
        },
        wrapped: {
          symbol: data.dex?.wrappedNative?.symbol || `W${data.currency?.symbol || 'ETH'}`,
          name: data.dex?.wrappedNative?.name || `Wrapped ${data.currency?.name || 'Ether'}`,
          icon: data.dex?.wrappedNative?.icon || data.currency?.icon || null,
          color: data.dex?.wrappedNative?.color || data.currency?.color || DEFAULT_COLOR,
        },
        reward: data.dex?.rewardToken ? {
          symbol: data.dex.rewardToken.symbol,
          name: data.dex.rewardToken.name,
          icon: data.dex.rewardToken.icon || null,
          color: data.dex.rewardToken.color || DEFAULT_COLOR,
        } : null,
      };
      
      clientCache = tokenConfig;
      clientCacheTimestamp = Date.now();
      setConfig(tokenConfig);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch token config');
      console.error('Error fetching token config:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Get token icon path for a symbol
  const getTokenIcon = useCallback((symbol: string): string | null => {
    if (!config) return null;
    
    // Check if it's native token
    if (symbol === config.native.symbol) {
      return config.native.icon;
    }
    // Check if it's wrapped token (also use native icon)
    if (symbol === config.wrapped.symbol) {
      return config.wrapped.icon;
    }
    // Check if it's reward token
    if (config.reward && symbol === config.reward.symbol) {
      return config.reward.icon;
    }
    
    return null;
  }, [config]);

  // Get token color for a symbol
  const getTokenColor = useCallback((symbol: string): string => {
    if (!config) return DEFAULT_COLOR;
    
    if (symbol === config.native.symbol) {
      return config.native.color;
    }
    if (symbol === config.wrapped.symbol) {
      return config.wrapped.color;
    }
    if (config.reward && symbol === config.reward.symbol) {
      return config.reward.color;
    }
    
    return DEFAULT_COLOR;
  }, [config]);

  // Display native symbol instead of wrapped (e.g., show VBC instead of WVBC)
  const displaySymbol = useCallback((symbol: string): string => {
    if (!config) return symbol;
    
    // If symbol matches wrapped token, return native symbol
    if (symbol === config.wrapped.symbol) {
      return config.native.symbol;
    }
    
    return symbol;
  }, [config]);

  return { 
    config, 
    isLoading, 
    error, 
    getTokenIcon, 
    getTokenColor, 
    displaySymbol 
  };
}
