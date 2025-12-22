'use client';

import { useMemo, useState, useCallback } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { formatUnits, parseUnits, type Address } from 'viem';
import { useReadContracts } from 'wagmi';
import { TokenFactoryABI, ERC20ABI } from '@/abi/TokenFactoryABI';
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
  userBalance?: bigint;
}

export function MyTokens() {
  const { address, isConnected } = useAccount();
  const { config, isLoading: isConfigLoading } = useLaunchpadConfig();
  const [refreshKey, setRefreshKey] = useState(0);

  // Function to trigger refresh
  const triggerRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  // Get user's tokens from factory
  const { data: userTokenAddresses, isLoading: isTokensLoading, refetch: refetchTokens } = useReadContract({
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
  const { data: tokenInfoResults, isLoading: isInfoLoading, refetch: refetchTokenInfo } = useReadContracts({
    contracts: tokenInfoContracts,
    query: {
      enabled: tokenInfoContracts.length > 0,
    },
  });

  // Prepare contracts for batch reading user balances
  const balanceContracts = (userTokenAddresses || []).map((tokenAddress: Address) => ({
    address: tokenAddress,
    abi: ERC20ABI,
    functionName: 'balanceOf' as const,
    args: [address as Address] as const,
  }));

  // Batch read user balances
  const { data: balanceResults, isLoading: isBalanceLoading, refetch: refetchBalances } = useReadContracts({
    contracts: balanceContracts,
    query: {
      enabled: balanceContracts.length > 0 && !!address,
    },
  });

  // Function to refresh all data
  const refreshAllData = useCallback(async () => {
    await Promise.all([
      refetchTokens(),
      refetchTokenInfo(),
      refetchBalances(),
    ]);
    triggerRefresh();
  }, [refetchTokens, refetchTokenInfo, refetchBalances, triggerRefresh]);

  // Process token data with useMemo
  const tokens = useMemo(() => {
    if (!userTokenAddresses || !tokenInfoResults) return [];
    
    const processedTokens: TokenInfo[] = [];
    
    for (let i = 0; i < userTokenAddresses.length; i++) {
      const result = tokenInfoResults[i];
      const balanceResult = balanceResults?.[i];
      
      if (result.status === 'success' && result.result) {
        const [creator, name, symbol, decimals, totalSupply, createdAt] = result.result as [string, string, string, number, bigint, bigint];
        const userBalance = balanceResult?.status === 'success' ? balanceResult.result as bigint : BigInt(0);
        
        // Skip tokens where user has no balance (fully burned/transferred)
        if (userBalance === BigInt(0)) continue;
        
        processedTokens.push({
          address: userTokenAddresses[i] as string,
          name,
          symbol,
          decimals,
          totalSupply,
          creator,
          createdAt: Number(createdAt),
          userBalance,
        });
      }
    }
    
    // Sort by creation time (newest first)
    processedTokens.sort((a, b) => b.createdAt - a.createdAt);
    return processedTokens;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userTokenAddresses, tokenInfoResults, balanceResults, refreshKey]);

  const isLoading = isConfigLoading || isTokensLoading || isInfoLoading || isBalanceLoading;

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
              <MyTokenCard key={token.address} token={token} onBurnSuccess={refreshAllData} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Dead address for burning tokens (transfer to this address = burn)
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dead' as const;

function MyTokenCard({ token, onBurnSuccess }: { token: TokenInfo; onBurnSuccess?: () => void }) {
  const { address } = useAccount();
  const [showBurnModal, setShowBurnModal] = useState(false);
  const [burnAmount, setBurnAmount] = useState('');
  
  const formattedSupply = formatUnits(token.totalSupply, token.decimals);
  const createdDate = new Date(token.createdAt * 1000).toLocaleDateString();
  const createdTime = new Date(token.createdAt * 1000).toLocaleTimeString();

  // Use pre-fetched user balance from parent, fallback to token.userBalance
  const userBalance = token.userBalance ?? BigInt(0);

  // Burn transaction (transfer to dead address)
  const { writeContract: burn, data: burnHash, isPending: isBurning, reset: resetBurn } = useWriteContract();
  
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: burnHash,
  });

  const handleBurn = () => {
    if (!burnAmount || !token.address) return;
    
    try {
      const amountToBurn = parseUnits(burnAmount, token.decimals);
      
      // Use transfer to dead address instead of burn function
      burn({
        address: token.address as Address,
        abi: ERC20ABI,
        functionName: 'transfer',
        args: [DEAD_ADDRESS, amountToBurn],
      }, {
        onError: (error: Error) => {
          console.error('Burn transaction error:', error);
          alert(`Burn failed: ${error.message}`);
        }
      });
    } catch (error) {
      console.error('ParseUnits error:', error);
      alert(`Invalid amount format: ${burnAmount}`);
    }
  };

  const handleBurnAll = () => {
    if (!userBalance || userBalance === BigInt(0)) return;
    setBurnAmount(formatUnits(userBalance, token.decimals));
  };

  const closeBurnModal = () => {
    setShowBurnModal(false);
    setBurnAmount('');
    resetBurn();
    // Refresh parent list after burn success
    if (isConfirmed && onBurnSuccess) {
      onBurnSuccess();
    }
  };

  const formattedBalance = userBalance ? formatUnits(userBalance, token.decimals) : '0';

  return (
    <>
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

        <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-700">
          <div>
            <div className="text-xs text-gray-500">Total Supply</div>
            <div className="text-sm text-white font-medium">
              {Number(formattedSupply).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Your Balance</div>
            <div className="text-sm text-white font-medium">
              {Number(formattedBalance).toLocaleString(undefined, { maximumFractionDigits: 2 })}
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
            <button
              onClick={() => setShowBurnModal(true)}
              className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-sm text-red-400 transition-colors"
            >
              Burn
            </button>
          </div>
        </div>
      </div>

      {/* Burn Modal */}
      {showBurnModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl p-6 max-w-md w-full border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
                </svg>
                Burn {token.symbol}
              </h3>
              <button
                onClick={closeBurnModal}
                className="p-1 hover:bg-gray-700 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {isConfirmed ? (
              <div className="text-center py-6">
                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h4 className="text-lg font-semibold text-white mb-2">Burn Successful!</h4>
                <p className="text-gray-400 text-sm mb-4">
                  {burnAmount} {token.symbol} has been burned.
                </p>
                <button
                  onClick={closeBurnModal}
                  className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-white transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4">
                  <p className="text-red-400 text-sm">
                    ⚠️ Warning: Burning tokens is irreversible. The burned tokens will be permanently destroyed.
                  </p>
                </div>

                <div className="mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm text-gray-400">Amount to Burn</label>
                    <span className="text-xs text-gray-500">
                      Balance: {Number(formattedBalance).toLocaleString(undefined, { maximumFractionDigits: 4 })} {token.symbol}
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      value={burnAmount}
                      onChange={(e) => setBurnAmount(e.target.value)}
                      placeholder="0.0"
                      className="w-full px-4 py-3 pr-20 bg-gray-700/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    />
                    <button
                      onClick={handleBurnAll}
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 text-xs text-red-400 hover:text-red-300 bg-red-500/20 hover:bg-red-500/30 rounded-lg transition-colors"
                    >
                      MAX
                    </button>
                  </div>
                </div>

                <button
                  onClick={handleBurn}
                  disabled={!burnAmount || isBurning || isConfirming || Number(burnAmount) <= 0 || Number(burnAmount) > Number(formattedBalance)}
                  className="w-full py-3 bg-gradient-to-r from-red-500 to-orange-500 text-white font-semibold rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2"
                >
                  {isBurning || isConfirming ? (
                    <>
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      {isBurning ? 'Confirming...' : 'Processing...'}
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                      </svg>
                      Burn Tokens
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
