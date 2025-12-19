'use client';

import { useMemo } from 'react';
import { useAccount } from 'wagmi';
import { formatUnits, type Address } from 'viem';
import { useReadContract, useReadContracts } from 'wagmi';
import { TokenFactoryABI } from '@/abi/TokenFactoryABI';
import { useLaunchpadConfig } from '@/hooks/useLaunchpadConfig';
import { ConnectWalletButton } from './ConnectWalletButton';

interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  creator: string;
  createdAt: number;
}

export function MyTokens() {
  const { address, isConnected } = useAccount();
  const { config, isLoading: isConfigLoading } = useLaunchpadConfig();

  // Get user's tokens from factory
  const { data: userTokenAddresses, isLoading: isTokensLoading } = useReadContract({
    address: config?.factoryAddress as Address,
    abi: TokenFactoryABI,
    functionName: 'getTokensByCreator',
    args: [address as Address],
    query: {
      enabled: !!config?.factoryAddress && !!address && isConnected,
    },
  });

  // Prepare contracts for batch reading token info
  const tokenInfoContracts = (userTokenAddresses || []).map((tokenAddress: Address) => ({
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

  // Process token data with useMemo
  const tokens = useMemo(() => {
    if (!userTokenAddresses || !tokenInfoResults) return [];
    
    const processedTokens: TokenInfo[] = [];
    
    for (let i = 0; i < userTokenAddresses.length; i++) {
      const result = tokenInfoResults[i];
      if (result.status === 'success' && result.result) {
        const [creator, name, symbol, decimals, totalSupply, createdAt] = result.result as [string, string, string, number, bigint, bigint];
        processedTokens.push({
          address: userTokenAddresses[i] as string,
          name,
          symbol,
          decimals,
          totalSupply,
          creator,
          createdAt: Number(createdAt),
        });
      }
    }
    
    // Sort by creation time (newest first)
    processedTokens.sort((a, b) => b.createdAt - a.createdAt);
    return processedTokens;
  }, [userTokenAddresses, tokenInfoResults]);

  const isLoading = isConfigLoading || isTokensLoading || isInfoLoading;

  // Check if factory is deployed
  const isFactoryDeployed = config?.factoryAddress && 
    config.factoryAddress !== '0x0000000000000000000000000000000000000000';

  // Not connected
  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-8 shadow-xl border border-gray-700/50 text-center">
          <div className="w-20 h-20 bg-gray-700/50 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Connect Your Wallet</h2>
          <p className="text-gray-400 mb-6">Connect your wallet to see tokens you&apos;ve created</p>
          <div className="max-w-xs mx-auto">
            <ConnectWalletButton />
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-gray-800/90 rounded-3xl p-6 shadow-xl border border-gray-700/50">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-700 rounded w-48 mb-6"></div>
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            My Tokens
          </h2>
          <div className="text-gray-400 text-sm">
            {tokens.length} token{tokens.length !== 1 ? 's' : ''} created
          </div>
        </div>

        {/* No tokens */}
        {tokens.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-700/50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No Tokens Yet</h3>
            <p className="text-gray-400 mb-4">You haven&apos;t created any tokens yet</p>
            <a
              href="/launchpad"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:opacity-90 transition-opacity"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Your First Token
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {tokens.map((token) => (
              <MyTokenCard key={token.address} token={token} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MyTokenCard({ token }: { token: TokenInfo }) {
  const formattedSupply = formatUnits(token.totalSupply, token.decimals);
  const createdDate = new Date(token.createdAt * 1000).toLocaleDateString();
  const createdTime = new Date(token.createdAt * 1000).toLocaleTimeString();

  return (
    <div className="bg-gray-800/50 rounded-xl p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold text-xl">
            {token.symbol.charAt(0)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-semibold text-lg">{token.name}</span>
              <span className="text-gray-400">({token.symbol})</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <a
                href={`/token/${token.address}`}
                className="text-purple-400 hover:text-purple-300 text-sm font-mono"
              >
                {token.address.slice(0, 14)}...{token.address.slice(-10)}
              </a>
              <button
                onClick={() => navigator.clipboard.writeText(token.address)}
                className="p-1 hover:bg-gray-600 rounded transition-colors"
                title="Copy address"
              >
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="bg-purple-500/20 text-purple-400 text-xs px-2 py-1 rounded-full mb-2">
            Created
          </div>
          <div className="text-sm text-gray-400">{createdDate}</div>
          <div className="text-xs text-gray-500">{createdTime}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-700">
        <div>
          <div className="text-xs text-gray-500">Total Supply</div>
          <div className="text-sm text-white font-medium">
            {Number(formattedSupply).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Decimals</div>
          <div className="text-sm text-white font-medium">{token.decimals}</div>
        </div>
        <div className="flex justify-end gap-2">
          <a
            href={`/token/${token.address}`}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-white transition-colors"
          >
            View
          </a>
          <a
            href={`/dex?tab=pool&token=${token.address}`}
            className="px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 rounded-lg text-sm text-purple-400 transition-colors"
          >
            Add Liquidity
          </a>
        </div>
      </div>
    </div>
  );
}
