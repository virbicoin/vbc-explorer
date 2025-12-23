'use client';

import { useState, useMemo, useEffect } from 'react';
import { formatUnits, type Address } from 'viem';
import { useReadContract, useReadContracts } from 'wagmi';
import { TokenFactoryV2ABI } from '@/abi/TokenFactoryV2ABI';
import { TokenFactoryABI, ERC20ABI } from '@/abi/TokenFactoryABI';
import { useLaunchpadConfig } from '@/hooks/useLaunchpadConfig';
import Link from 'next/link';

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
  // V2 metadata
  logoUrl?: string;
  description?: string;
  website?: string;
}

export function TokenList() {
  const { config, isLoading: isConfigLoading, activeFactoryAddress } = useLaunchpadConfig();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const tokensPerPage = 10;

  const isV2 = config?.useV2 ?? true;
  const factoryABI = isV2 ? TokenFactoryV2ABI : TokenFactoryABI;

  // Get token count from factory
  const { data: tokenCount, isLoading: isCountLoading } = useReadContract({
    address: activeFactoryAddress as Address,
    abi: factoryABI,
    functionName: 'getTokenCount',
    query: {
      enabled: !!activeFactoryAddress,
    },
  });

  // Get all token addresses
  const { data: allTokens, isLoading: isTokensLoading } = useReadContract({
    address: activeFactoryAddress as Address,
    abi: factoryABI,
    functionName: 'getAllTokens',
    query: {
      enabled: !!activeFactoryAddress,
    },
  });

  // Prepare contracts for batch reading token info (V2 uses getTokenDetails for metadata)
  const tokenInfoContracts = (allTokens || []).map((tokenAddress: Address) => ({
    address: activeFactoryAddress as Address,
    abi: factoryABI,
    functionName: isV2 ? 'getTokenDetails' : 'tokenInfo',
    args: [tokenAddress] as const,
  }));

  // Batch read token info from factory
  const { data: tokenInfoResults, isLoading: isInfoLoading } = useReadContracts({
    contracts: tokenInfoContracts,
    query: {
      enabled: tokenInfoContracts.length > 0,
    },
  });

  // Prepare contracts for batch reading actual totalSupply from token contracts
  // (Factory stores initial supply, not current supply after burns)
  const totalSupplyContracts = (allTokens || []).map((tokenAddress: Address) => ({
    address: tokenAddress,
    abi: ERC20ABI,
    functionName: 'totalSupply' as const,
    args: [] as const,
  }));

  // Batch read actual totalSupply
  const { data: totalSupplyResults, isLoading: isTotalSupplyLoading } = useReadContracts({
    contracts: totalSupplyContracts,
    query: {
      enabled: totalSupplyContracts.length > 0,
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
      const totalSupplyResult = totalSupplyResults?.[i];
      const deadBalanceResult = deadBalanceResults?.[i];
      
      if (result.status === 'success' && result.result) {
        // Get actual totalSupply from token contract (not factory's stored initial supply)
        const actualTotalSupply = totalSupplyResult?.status === 'success' 
          ? totalSupplyResult.result as bigint 
          : BigInt(0);
        
        // Skip tokens with zero total supply (fully burned via burn())
        if (actualTotalSupply <= BigInt(0)) continue;
        
        let tokenData: TokenInfo;
        
        if (isV2) {
          // V2: getTokenDetails returns more fields including metadata
          const [creator, name, symbol, decimals, , createdAt, logoUrl, description, website] = result.result as [string, string, string, number, bigint, bigint, string, string, string];
          tokenData = {
            address: allTokens[i] as string,
            name,
            symbol,
            decimals,
            totalSupply: actualTotalSupply, // Use actual totalSupply from token contract
            creator,
            createdAt: Number(createdAt),
            logoUrl,
            description,
            website,
          };
        } else {
          // V1: tokenInfo returns basic fields
          const [creator, name, symbol, decimals, , createdAt] = result.result as [string, string, string, number, bigint, bigint];
          tokenData = {
            address: allTokens[i] as string,
            name,
            symbol,
            decimals,
            totalSupply: actualTotalSupply, // Use actual totalSupply from token contract
            creator,
            createdAt: Number(createdAt),
          };
        }
        
        const deadBalance = deadBalanceResult?.status === 'success' ? deadBalanceResult.result as bigint : BigInt(0);
        
        // Calculate circulating supply (totalSupply - burned to dead address)
        const circulatingSupply = actualTotalSupply - deadBalance;
        
        // Skip tokens fully sent to dead address
        if (circulatingSupply <= BigInt(0)) continue;
        
        processedTokens.push({
          ...tokenData,
          circulatingSupply,
        });
      }
    }
    
    // Sort by creation time (newest first)
    processedTokens.sort((a, b) => b.createdAt - a.createdAt);
    return processedTokens;
  }, [allTokens, tokenInfoResults, totalSupplyResults, deadBalanceResults, isV2]);

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

  const isLoading = isConfigLoading || isCountLoading || isTokensLoading || isInfoLoading || isTotalSupplyLoading || isDeadBalanceLoading;

  // Check if factory is deployed
  const isFactoryDeployed = activeFactoryAddress && 
    activeFactoryAddress !== '0x0000000000000000000000000000000000000000';

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
            {tokens.length} tokens created
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
              <TokenCard key={token.address} token={token} isV2={isV2} />
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

function TokenCard({ token, isV2 }: { token: TokenInfo; isV2: boolean }) {
  const [isVerified, setIsVerified] = useState(false);
  const formattedSupply = formatUnits(token.totalSupply, token.decimals);
  const dateObj = new Date(token.createdAt * 1000);
  const createdDate = dateObj.toLocaleDateString();
  const createdTime = dateObj.toLocaleTimeString() + ' ' + dateObj.toLocaleTimeString(undefined, { timeZoneName: 'short' }).split(' ').pop();

  // Check if contract is verified
  useEffect(() => {
    fetch(`/api/contract/status/${token.address}`)
      .then(res => res.json())
      .then(data => setIsVerified(data.verified === true))
      .catch(() => setIsVerified(false));
  }, [token.address]);

  const addToMetaMask = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof window === 'undefined' || !window.ethereum) return;
    try {
       
      await (window.ethereum as any).request({
        method: 'wallet_watchAsset',
        params: { type: 'ERC20', options: { address: token.address, symbol: token.symbol.slice(0, 11), decimals: token.decimals, image: token.logoUrl || undefined } },
      });
    } catch (err) { console.error('Failed to add token to MetaMask:', err); }
  };

  // Suppress unused variable warning
  void isV2;

  return (
    <Link 
      href={`/launchpad/token/${token.address}`}
      className="block bg-gray-800/50 hover:bg-gray-700/50 rounded-xl p-4 transition-colors group"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Token Logo */}
          {token.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img 
              src={token.logoUrl} 
              alt={token.name}
              className="w-12 h-12 rounded-full object-cover"
              onError={(e) => {
                // Fallback to gradient if image fails
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                target.nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          <div className={`w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold text-lg ${token.logoUrl ? 'hidden' : ''}`}>
            {token.symbol.charAt(0)}
          </div>
          
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-semibold group-hover:text-purple-300 transition-colors">{token.name}</span>
              <span className="text-gray-400 text-sm">({token.symbol})</span>
              {isVerified && (
                <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-xs font-semibold rounded flex items-center gap-1" title="Verified Contract">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                  Verified
                </span>
              )}
            </div>
            {token.description && (
              <p className="text-gray-500 text-xs mt-0.5 line-clamp-1 max-w-md">{token.description}</p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <span className="text-purple-400 text-xs font-mono">
                {token.address.slice(0, 10)}...{token.address.slice(-8)}
              </span>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  navigator.clipboard.writeText(token.address);
                }}
                className="p-1 hover:bg-gray-600 rounded transition-colors"
                title="Copy address"
              >
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
              <button
                onClick={addToMetaMask}
                className="px-2 py-1 hover:bg-gray-600 rounded transition-colors flex items-center gap-1"
                title="Add to MetaMask"
              >
                <span className="text-sm">🦊</span>
                <span className="text-xs text-gray-400">Add to MetaMask</span>
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
          <div className="text-xs text-gray-500">{createdTime}</div>
        </div>
      </div>
    </Link>
  );
}
