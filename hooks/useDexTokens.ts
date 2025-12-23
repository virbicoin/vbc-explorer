'use client';

import { useState, useEffect, useCallback } from 'react';
import { type Token, getNativeToken } from '@/lib/dex/config';

interface UseDexTokensResult {
  tokens: Token[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Get fallback tokens dynamically (native token only)
function getFallbackTokens(): Token[] {
  return [getNativeToken()];
}

export function useDexTokens(): UseDexTokensResult {
  // Start with empty array to avoid flash of WVBC
  const [tokens, setTokens] = useState<Token[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/dex/tokens');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.tokens && Array.isArray(data.tokens)) {
        // Ensure proper typing for addresses
        const typedTokens: Token[] = data.tokens.map((token: any) => ({
          address: token.address as `0x${string}`,
          name: token.name,
          symbol: token.symbol,
          decimals: token.decimals,
          logoURI: token.logoURI,
        }));
        setTokens(typedTokens);
      }
    } catch (err) {
      console.error('Failed to fetch DEX tokens:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch tokens');
      // Keep fallback tokens on error
      setTokens(getFallbackTokens());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  return {
    tokens,
    isLoading,
    error,
    refetch: fetchTokens,
  };
}
