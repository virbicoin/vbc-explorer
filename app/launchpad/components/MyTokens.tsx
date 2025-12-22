'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { formatUnits, type Address } from 'viem';
import { useReadContract, useReadContracts } from 'wagmi';
import { TokenFactoryV2ABI, LaunchpadTokenV2ABI } from '@/abi/TokenFactoryV2ABI';
import { TokenFactoryABI, ERC20ABI } from '@/abi/TokenFactoryABI';
import { useLaunchpadConfig } from '@/hooks/useLaunchpadConfig';
import { ConnectWalletButton } from './ConnectWalletButton';
import Link from 'next/link';

interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  creator: string;
  createdAt: number;
  userBalance?: bigint;
  logoUrl?: string;
  description?: string;
  website?: string;
  isPaused?: boolean;
}

export function MyTokens() {
  const { address, isConnected } = useAccount();
  const { config, isLoading: isConfigLoading, activeFactoryAddress } = useLaunchpadConfig();
  const [refreshKey, setRefreshKey] = useState(0);

  const isV2 = config?.useV2 ?? true;
  const factoryABI = isV2 ? TokenFactoryV2ABI : TokenFactoryABI;

  const triggerRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  const { data: userTokenAddresses, isLoading: isTokensLoading, refetch: refetchTokens } = useReadContract({
    address: activeFactoryAddress as Address,
    abi: factoryABI,
    functionName: 'getTokensByCreator',
    args: [address as Address],
    query: {
      enabled: !!activeFactoryAddress && !!address && isConnected,
    },
  });

  const tokenInfoContracts = (userTokenAddresses || []).map((tokenAddress: Address) => ({
    address: activeFactoryAddress as Address,
    abi: factoryABI,
    functionName: isV2 ? 'getTokenDetails' : 'tokenInfo',
    args: [tokenAddress] as const,
  }));

  const { data: tokenInfoResults, isLoading: isInfoLoading, refetch: refetchTokenInfo } = useReadContracts({
    contracts: tokenInfoContracts,
    query: { enabled: tokenInfoContracts.length > 0 },
  });

  const balanceContracts = (userTokenAddresses || []).map((tokenAddress: Address) => ({
    address: tokenAddress,
    abi: ERC20ABI,
    functionName: 'balanceOf' as const,
    args: [address as Address] as const,
  }));

  const { data: balanceResults, isLoading: isBalanceLoading, refetch: refetchBalances } = useReadContracts({
    contracts: balanceContracts,
    query: { enabled: balanceContracts.length > 0 && !!address },
  });

  const pauseContracts = isV2 ? (userTokenAddresses || []).map((tokenAddress: Address) => ({
    address: tokenAddress,
    abi: LaunchpadTokenV2ABI,
    functionName: 'paused' as const,
    args: [] as const,
  })) : [];

  const { data: pauseResults, refetch: refetchPause } = useReadContracts({
    contracts: pauseContracts,
    query: { enabled: isV2 && pauseContracts.length > 0 },
  });

  const refreshAllData = useCallback(async () => {
    await Promise.all([
      refetchTokens(),
      refetchTokenInfo(),
      refetchBalances(),
      isV2 ? refetchPause() : Promise.resolve(),
    ]);
    triggerRefresh();
  }, [refetchTokens, refetchTokenInfo, refetchBalances, refetchPause, triggerRefresh, isV2]);

  // Suppress unused variable warning - refreshAllData is for future use
  void refreshAllData;

  const tokens = useMemo(() => {
    if (!userTokenAddresses || !tokenInfoResults) return [];
    
    const processedTokens: TokenInfo[] = [];
    
    for (let i = 0; i < userTokenAddresses.length; i++) {
      const result = tokenInfoResults[i];
      const balanceResult = balanceResults?.[i];
      const pauseResult = pauseResults?.[i];
      
      if (result.status === 'success' && result.result) {
        let tokenData: TokenInfo;
        
        if (isV2) {
          const [creator, name, symbol, decimals, totalSupply, createdAt, logoUrl, description, website] = result.result as [string, string, string, number, bigint, bigint, string, string, string];
          tokenData = { address: userTokenAddresses[i] as string, name, symbol, decimals, totalSupply, creator, createdAt: Number(createdAt), logoUrl, description, website };
        } else {
          const [creator, name, symbol, decimals, totalSupply, createdAt] = result.result as [string, string, string, number, bigint, bigint];
          tokenData = { address: userTokenAddresses[i] as string, name, symbol, decimals, totalSupply, creator, createdAt: Number(createdAt) };
        }
        
        const userBalance = balanceResult?.status === 'success' ? balanceResult.result as bigint : BigInt(0);
        const isPaused = pauseResult?.status === 'success' ? pauseResult.result as boolean : false;
        
        if (userBalance === BigInt(0)) continue;
        
        processedTokens.push({ ...tokenData, userBalance, isPaused });
      }
    }
    
    processedTokens.sort((a, b) => b.createdAt - a.createdAt);
    return processedTokens;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userTokenAddresses, tokenInfoResults, balanceResults, pauseResults, isV2, refreshKey]);

  const isLoading = isConfigLoading || isTokensLoading || isInfoLoading || isBalanceLoading;
  const isFactoryDeployed = activeFactoryAddress && activeFactoryAddress !== '0x0000000000000000000000000000000000000000';

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
          <div className="max-w-xs mx-auto"><ConnectWalletButton /></div>
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
            <div className="space-y-3">{[...Array(3)].map((_, i) => (<div key={i} className="h-20 bg-gray-700 rounded-xl"></div>))}</div>
          </div>
        </div>
      </div>
    );
  }

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
          <div className="text-gray-400 text-sm">{tokens.length} token{tokens.length !== 1 ? 's' : ''} created</div>
        </div>

        {tokens.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-700/50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No Tokens Yet</h3>
            <p className="text-gray-400 mb-4">You haven&apos;t created any tokens yet</p>
            <Link href="/launchpad?tab=create" className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:opacity-90 transition-opacity">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Your First Token
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {tokens.map((token) => (<MyTokenCard key={token.address} token={token} />))}
          </div>
        )}
      </div>
    </div>
  );
}

function MyTokenCard({ token }: { token: TokenInfo }) {
  const [isVerified, setIsVerified] = useState(false);
  const formattedSupply = formatUnits(token.totalSupply, token.decimals);
  const dateObj = new Date(token.createdAt * 1000);
  const createdDate = dateObj.toLocaleDateString();
  const createdTime = dateObj.toLocaleTimeString() + ' ' + dateObj.toLocaleTimeString(undefined, { timeZoneName: 'short' }).split(' ').pop();
  const userBalance = token.userBalance ?? BigInt(0);
  const formattedBalance = userBalance ? formatUnits(userBalance, token.decimals) : '0';

  // Check if contract is verified
  useEffect(() => {
    fetch(`/api/contract/status/${token.address}`)
      .then(res => res.json())
      .then(data => setIsVerified(data.verified === true))
      .catch(() => setIsVerified(false));
  }, [token.address]);

  const addToMetaMask = async () => {
    if (typeof window === 'undefined' || !window.ethereum) return;
    try {
       
      await (window.ethereum as any).request({
        method: 'wallet_watchAsset',
        params: { type: 'ERC20', options: { address: token.address, symbol: token.symbol.slice(0, 11), decimals: token.decimals, image: token.logoUrl || undefined } },
      });
    } catch (err) { console.error('Failed to add token to MetaMask:', err); }
  };

  return (
    <div className="bg-gray-800/50 rounded-xl p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          {token.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={token.logoUrl} alt={token.name} className="w-14 h-14 rounded-full object-cover" onError={(e) => { const target = e.target as HTMLImageElement; target.style.display = 'none'; target.nextElementSibling?.classList.remove('hidden'); }} />
          ) : null}
          <div className={`w-14 h-14 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold text-xl ${token.logoUrl ? 'hidden' : ''}`}>
            {token.symbol.charAt(0)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-semibold text-lg">{token.name}</span>
              <span className="text-gray-400">({token.symbol})</span>
              {isVerified && (
                <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-xs font-semibold rounded flex items-center gap-1" title="Verified Contract">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                  Verified
                </span>
              )}
              {token.isPaused && <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs font-semibold rounded-lg">Paused</span>}
            </div>
            {token.description && <p className="text-gray-500 text-xs mt-0.5 line-clamp-1 max-w-xs">{token.description}</p>}
            <div className="flex items-center gap-2 mt-1">
              <Link href={`/launchpad/token/${token.address}`} className="text-purple-400 hover:text-purple-300 text-sm font-mono">{token.address.slice(0, 14)}...{token.address.slice(-10)}</Link>
              <button onClick={() => navigator.clipboard.writeText(token.address)} className="p-1 hover:bg-gray-600 rounded transition-colors" title="Copy address">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              </button>
              <button onClick={addToMetaMask} className="px-2 py-1 hover:bg-gray-600 rounded transition-colors flex items-center gap-1" title="Add to MetaMask">
                <span className="text-sm">🦊</span>
                <span className="text-xs text-gray-400">Add to MetaMask</span>
              </button>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="bg-purple-500/20 text-purple-400 text-xs px-2 py-1 rounded-full mb-2">Created</div>
          <div className="text-sm text-gray-400">{createdDate}</div>
          <div className="text-xs text-gray-500">{createdTime}</div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-700">
        <div><div className="text-xs text-gray-500">Total Supply</div><div className="text-sm text-white font-medium">{Number(formattedSupply).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div>
        <div><div className="text-xs text-gray-500">Your Balance</div><div className="text-sm text-white font-medium">{Number(formattedBalance).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div>
        <div><div className="text-xs text-gray-500">Decimals</div><div className="text-sm text-white font-medium">{token.decimals}</div></div>
        <div className="flex justify-end items-center gap-1">
          <Link href={`/launchpad/token/${token.address}`} className="px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 rounded-lg text-xs text-purple-400 transition-colors font-medium" title="View Details">👁️ Manage</Link>
        </div>
      </div>
    </div>
  );
}
