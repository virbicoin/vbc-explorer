'use client';

import { useState, useMemo } from 'react';
import { formatUnits, type Address } from 'viem';
import { useReadContract, useReadContracts } from 'wagmi';
import { TokenFactoryABI, ERC20ABI } from '@/abi/TokenFactoryABI';
import { useLaunchpadConfig } from '@/hooks/useLaunchpadConfig';

// Dead address - tokens sent here are considered burned
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dead' as const;

interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  creator: string;
  createdAt: number;
  circulatingSupply?: bigint;
}

export function TokenList() {
  const { config, isLoading: isConfigLoading } = useLaunchpadConfig();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const tokensPerPage = 10;

  // Get token count from factory
  const { data: tokenCount, isLoading: isCountLoading } = useReadContract({
    address: config?.factoryAddress as Address,
    abi: TokenFactoryABI,
    functionName: 'getTokenCount',
    query: {
      enabled: !!config?.factoryAddress,
    },
  });

  // Get all token addresses
  const { data: allTokens, isLoading: isTokensLoading } = useReadContract({
    address: config?.factoryAddress as Address,
    abi: TokenFactoryABI,
    functionName: 'getAllTokens',
    query: {
      enabled: !!config?.factoryAddress,
    },
  });

  // Prepare contracts for batch reading token info
  const tokenInfoContracts = (allTokens || []).map((tokenAddress: Address) => ({
    address: config?.factoryAddress as Address,
    abi: TokenFactoryABI,
    functionName: 'tokenInfo' as const,
    args: [tokenAddress] as const,
  }));

  // Batch read token info from factory
  const { data: tokenInfoResults, isLoading: isInfoLoading } = useReadContracts({
    contracts: tokenInfoContracts,
    query: {
      enabled: tokenInfoContracts.length > 0,
    },
  });

  // Prepare contracts for batch reading dead address balances
  const deadBalanceContracts = (allTokens || []).map((tokenAddress: Address) => ({
    address: tokenAddress,
    abi: ERC20ABI,
    functionName: 'balanceOf' as const,
    args: [DEAD_ADDRESS] as const,
  }));

  // Batch read dead address balances
  const { data: deadBalanceResults, isLoading: isDeadBalanceLoading } = useReadContracts({
    contracts: deadBalanceContracts,
    query: {
      enabled: deadBalanceContracts.length > 0,
    },
  });

  // Process token data with useMemo
  const tokens = useMemo(() => {
    if (!allTokens || !tokenInfoResults) return [];
    
    const processedTokens: TokenInfo[] = [];
    
    for (let i = 0; i < allTokens.length; i++) {
      const result = tokenInfoResults[i];
      const deadBalanceResult = deadBalanceResults?.[i];
      
      if (result.status === 'success' && result.result) {
        const [creator, name, symbol, decimals, totalSupply, createdAt] = result.result as [string, string, string, number, bigint, bigint];
        const deadBalance = deadBalanceResult?.status === 'success' ? deadBalanceResult.result as bigint : BigInt(0);
        
        // Calculate circulating supply (totalSupply - burned)
        const circulatingSupply = totalSupply - deadBalance;
        
        // Skip fully burned tokens (circulating supply === 0)
        if (circulatingSupply <= BigInt(0)) continue;
        
        processedTokens.push({
          address: allTokens[i] as string,
          name,
          symbol,
          decimals,
          totalSupply,
          creator,
          createdAt: Number(createdAt),
          circulatingSupply,
        });
      }
    }
    
    // Sort by creation time (newest first)
    processedTokens.sort((a, b) => b.createdAt - a.createdAt);
    return processedTokens;
  }, [allTokens, tokenInfoResults, deadBalanceResults]);

  // Filter tokens by search query
  const filteredTokens = tokens.filter(token =>
    token.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    token.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    token.address.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Paginate tokens
  const totalPages = Math.ceil(filteredTokens.length / tokensPerPage);
  const paginatedTokens = filteredTokens.slice(
    (currentPage - 1) * tokensPerPage,
    currentPage * tokensPerPage
  );

  const isLoading = isConfigLoading || isCountLoading || isTokensLoading || isInfoLoading || isDeadBalanceLoading;

  // Check if factory is deployed
  const isFactoryDeployed = config?.factoryAddress && 
    config.factoryAddress !== '0x0000000000000000000000000000000000000000';

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-gray-800/90 rounded-3xl p-6 shadow-xl border border-gray-700/50">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-700 rounded w-48 mb-6"></div>
            <div className="h-12 bg-gray-700 rounded-xl mb-6"></div>
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-20 bg-gray-700 rounded-xl"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show message if factory is not deployed
  if (!isFactoryDeployed) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-8 shadow-xl border border-gray-700/50 text-center">
          <div className="w-16 h-16 bg-gray-700/50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">No Tokens Yet</h3>
          <p className="text-gray-400">Token Factory is not yet deployed on this network.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 shadow-xl border border-gray-700/50">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            All Tokens
          </h2>
          <div className="text-gray-400 text-sm">
            {tokenCount ? Number(tokenCount).toString() : '0'} tokens created
          </div>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name, symbol, or address..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-12 pr-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Token List */}
        {paginatedTokens.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-700/50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No Tokens Found</h3>
            <p className="text-gray-400">
              {searchQuery ? 'No tokens match your search' : 'No tokens have been created yet'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {paginatedTokens.map((token) => (
              <TokenCard key={token.address} token={token} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg bg-gray-700/50 hover:bg-gray-600/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-gray-400 text-sm px-4">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg bg-gray-700/50 hover:bg-gray-600/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TokenCard({ token }: { token: TokenInfo }) {
  const formattedSupply = formatUnits(token.totalSupply, token.decimals);
  const createdDate = new Date(token.createdAt * 1000).toLocaleDateString();

  return (
    <div className="bg-gray-800/50 hover:bg-gray-700/50 rounded-xl p-4 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
            {token.symbol.charAt(0)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-semibold">{token.name}</span>
              <span className="text-gray-400 text-sm">({token.symbol})</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <a
                href={`/token/${token.address}`}
                className="text-purple-400 hover:text-purple-300 text-xs font-mono"
              >
                {token.address.slice(0, 10)}...{token.address.slice(-8)}
              </a>
              <button
                onClick={() => navigator.clipboard.writeText(token.address)}
                className="p-1 hover:bg-gray-600 rounded transition-colors"
                title="Copy address"
              >
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-400">Total Supply</div>
          <div className="text-white font-medium">
            {Number(formattedSupply).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-gray-500">{createdDate}</div>
        </div>
      </div>
    </div>
  );
}
