'use client';

import { useState } from 'react';
import { ethers } from 'ethers';
import Image from 'next/image';
import { useFarming, type PoolData } from '@/hooks/useFarming';
import { useTokenConfig } from '@/hooks/useTokenConfig';

// Default color for unknown tokens
const DEFAULT_COLOR = 'from-gray-500 to-gray-600';

// Token Icon Component - uses config for icons/colors
function FarmTokenIcon({ 
  symbol, 
  size = 32,
  getIcon,
  getColor
}: { 
  symbol: string; 
  size?: number;
  getIcon: (symbol: string) => string | null;
  getColor: (symbol: string) => string;
}) {
  const iconPath = getIcon(symbol);
  const color = getColor(symbol);
  
  if (iconPath) {
    return (
      <div 
        className={`rounded-full bg-gradient-to-br ${color} flex items-center justify-center border-2 border-gray-800 overflow-hidden`} 
        style={{ width: size, height: size }}
      >
        <Image 
          src={iconPath} 
          alt={symbol} 
          width={size - 4} 
          height={size - 4}
          className="object-contain"
        />
      </div>
    );
  }
  
  return (
    <div 
      className={`rounded-full bg-gradient-to-br ${color} flex items-center justify-center border-2 border-gray-800`} 
      style={{ width: size, height: size }}
    >
      <span className="font-bold text-white" style={{ fontSize: size * 0.4 }}>{symbol.charAt(0)}</span>
    </div>
  );
}

// Farm Pool Card Component - always expanded like Swap/Pool
function FarmPoolCard({
  pool,
  userStaked,
  pendingReward,
  lpBalance,
  allowance,
  onApprove,
  onDeposit,
  onWithdraw,
  onHarvest,
  loading,
  isConnected,
  getTokenIcon,
  getTokenColor,
  displaySymbol,
}: {
  pool: PoolData;
  userStaked: bigint;
  pendingReward: bigint;
  lpBalance: bigint;
  allowance: bigint;
  onApprove: () => void;
  onDeposit: (amount: string) => void;
  onWithdraw: (amount: string) => void;
  onHarvest: () => void;
  loading: boolean;
  isConnected: boolean;
  getTokenIcon: (symbol: string) => string | null;
  getTokenColor: (symbol: string) => string;
  displaySymbol: (symbol: string) => string;
}) {
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');

  const needsApproval = allowance === 0n || (depositAmount && parseFloat(depositAmount) > 0 && 
    ethers.parseEther(depositAmount || '0') > allowance);

  const handleDeposit = () => {
    if (depositAmount && parseFloat(depositAmount) > 0) {
      onDeposit(depositAmount);
      setDepositAmount('');
    }
  };

  const handleWithdraw = () => {
    if (withdrawAmount && parseFloat(withdrawAmount) > 0) {
      onWithdraw(withdrawAmount);
      setWithdrawAmount('');
    }
  };

  // Auto-scaling LP display (recommended by contract)
  // When LP value is too small with 18 decimals, display with 9 decimals as "nLP" (nano LP)
  const formatLPAmount = (rawAmount: bigint): string => {
    if (rawAmount === 0n) return '0';
    
    const ethValue = Number(rawAmount) / 1e18;
    if (ethValue >= 0.0001) {
      // Normal display with 18 decimals
      return ethValue.toLocaleString('en-US', { maximumFractionDigits: 4 });
    }
    // Small value - display with 9 decimals as nLP (nano LP)
    const nanoValue = Number(rawAmount) / 1e9;
    return nanoValue.toLocaleString('en-US', { maximumFractionDigits: 4 });
  };

  // Get LP unit suffix based on value size
  const getLPUnit = (rawAmount: bigint): string => {
    if (rawAmount === 0n) return 'LP';
    const ethValue = Number(rawAmount) / 1e18;
    return ethValue >= 0.0001 ? 'LP' : 'nLP';
  };

  // Always use 18 decimals for reward token (VBCG)
  const formatRewardAmount = (amount: bigint): string => {
    if (amount === 0n) return '0';
    const num = Number(amount) / 1e18;
    if (num < 0.0001 && num > 0) {
      return num.toExponential(2);
    }
    return num.toLocaleString('en-US', { maximumFractionDigits: 4 });
  };

  return (
    <div className="bg-gray-900/50 rounded-2xl border border-gray-700/50 overflow-hidden p-4 space-y-4">
      {/* Pool Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Token Pair Icons - same style as Pool */}
          <div className="flex -space-x-2">
            <FarmTokenIcon symbol={pool.token0Symbol} size={32} getIcon={getTokenIcon} getColor={getTokenColor} />
            <FarmTokenIcon symbol={pool.token1Symbol} size={32} getIcon={getTokenIcon} getColor={getTokenColor} />
          </div>
          <div>
            {/* Use / separator like Pool, display native symbol instead of wrapped */}
            <h3 className="font-semibold text-white">{displaySymbol(pool.token0Symbol)}/{displaySymbol(pool.token1Symbol)} Pool</h3>
            <p className="text-xs text-gray-500">Farm #{pool.pid}</p>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4 p-3 bg-gray-800/50 rounded-xl">
        <div>
          <p className="text-xs text-gray-500">APR</p>
          <p className="font-semibold text-green-400" title={pool.apr < 0 ? 'Insufficient liquidity for APR calculation' : undefined}>
            {pool.apr < 0 ? '—' : pool.apr >= 9999 ? '>9999%' : pool.apr < 0.01 && pool.apr >= 0 ? '<0.01%' : `${pool.apr.toFixed(2)}%`}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Total Staked</p>
          <p className="font-semibold text-white">{formatLPAmount(pool.totalStaked)} {getLPUnit(pool.totalStaked)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Pending Reward</p>
          <p className="font-semibold text-yellow-400">{formatRewardAmount(pendingReward)}</p>
        </div>
      </div>

      {/* User Stats */}
      {isConnected && (
        <div className="grid grid-cols-2 gap-4 p-3 bg-gray-800/50 rounded-xl">
          <div>
            <p className="text-xs text-gray-500">Your Staked</p>
            <p className="text-white font-semibold">{formatLPAmount(userStaked)} {getLPUnit(userStaked)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">LP Balance</p>
            <p className="text-white font-semibold">{formatLPAmount(lpBalance)} {getLPUnit(lpBalance)}</p>
          </div>
        </div>
      )}

      {/* Harvest Button - only one, shown when rewards available */}
      {isConnected && pendingReward > 0n && (
        <button
          onClick={onHarvest}
          disabled={loading}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-yellow-600 to-orange-600 text-white font-semibold hover:from-yellow-500 hover:to-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {loading ? 'Harvesting...' : `Harvest ${formatRewardAmount(pendingReward)} Rewards`}
        </button>
      )}

      {/* Deposit Section - always visible */}
      {isConnected && (
        <div className="p-4 bg-gray-800/30 rounded-xl border border-gray-700/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">Deposit LP</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Balance: {formatLPAmount(lpBalance)} {getLPUnit(lpBalance)}</span>
              <button
                onClick={() => setDepositAmount(ethers.formatEther(lpBalance / 2n))}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium px-2 py-0.5 bg-blue-500/10 rounded"
              >
                HALF
              </button>
              <button
                onClick={() => setDepositAmount(ethers.formatEther(lpBalance))}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium px-2 py-0.5 bg-blue-500/10 rounded"
              >
                MAX
              </button>
            </div>
          </div>
          <input
            type="number"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            placeholder="0.0"
            className="w-full bg-transparent text-2xl text-white placeholder-gray-600 focus:outline-none mb-3"
          />
          {needsApproval ? (
            <button
              onClick={onApprove}
              disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold hover:from-blue-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? 'Approving...' : 'Approve LP Token'}
            </button>
          ) : (
            <button
              onClick={handleDeposit}
              disabled={loading || !depositAmount || parseFloat(depositAmount) <= 0}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-green-600 to-teal-600 text-white font-semibold hover:from-green-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? 'Depositing...' : 'Deposit'}
            </button>
          )}
        </div>
      )}

      {/* Withdraw Section - always visible when user has staked */}
      {isConnected && userStaked > 0n && (
        <div className="p-4 bg-gray-800/30 rounded-xl border border-gray-700/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">Withdraw LP</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Staked: {formatLPAmount(userStaked)} {getLPUnit(userStaked)}</span>
              <button
                onClick={() => setWithdrawAmount(ethers.formatEther(userStaked / 2n))}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium px-2 py-0.5 bg-blue-500/10 rounded"
              >
                HALF
              </button>
              <button
                onClick={() => setWithdrawAmount(ethers.formatEther(userStaked))}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium px-2 py-0.5 bg-blue-500/10 rounded"
              >
                MAX
              </button>
            </div>
          </div>
          <input
            type="number"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            placeholder="0.0"
            className="w-full bg-transparent text-2xl text-white placeholder-gray-600 focus:outline-none mb-3"
          />
          <button
            onClick={handleWithdraw}
            disabled={loading || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-red-600 to-pink-600 text-white font-semibold hover:from-red-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? 'Withdrawing...' : 'Withdraw'}
          </button>
        </div>
      )}

      {/* Not Connected Message */}
      {!isConnected && (
        <p className="text-center text-gray-500 text-sm py-4">
          Connect wallet to stake and earn rewards
        </p>
      )}
    </div>
  );
}

export default function FarmContent() {
  const {
    pools,
    userPools,
    loading,
    error,
    isConnected,
    configReady,
    connectWallet,
    approve,
    deposit,
    withdraw,
    harvest,
    harvestAll,
    refresh,
    clearError,
  } = useFarming();
  
  // Token configuration from config.json
  const { 
    getTokenIcon, 
    getTokenColor, 
    displaySymbol,
    isLoading: tokenConfigLoading 
  } = useTokenConfig();

  // Loading state while config is being loaded
  if (!configReady || tokenConfigLoading) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 shadow-xl border border-gray-700/50">
          <div className="flex flex-col items-center justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mb-4"></div>
            <p className="text-gray-400">Loading farm configuration...</p>
          </div>
        </div>
      </div>
    );
  }

  // Check if there are any pending rewards
  const hasPendingRewards = Array.from(userPools.values()).some(u => u.pendingReward > 0n);

  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 shadow-xl border border-gray-700/50">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold text-white">Farm</h2>
          {isConnected && hasPendingRewards && (
            <button
              onClick={harvestAll}
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-yellow-600 to-orange-600 text-white text-sm font-semibold hover:from-yellow-500 hover:to-orange-500 disabled:opacity-50 transition-all"
            >
              Harvest All
            </button>
          )}
        </div>
        <p className="text-sm text-gray-400 mb-6">Stake LP tokens to earn rewards</p>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-4 bg-red-500/20 border border-red-500/50 rounded-xl">
            <div className="flex items-center justify-between">
              <p className="text-red-400 text-sm">{error}</p>
              <button onClick={clearError} className="text-red-400 hover:text-red-300">✕</button>
            </div>
          </div>
        )}

        {/* Connect Wallet */}
        {!isConnected ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <p className="text-gray-400 mb-4">Connect your wallet to start farming</p>
            <button
              onClick={connectWallet}
              disabled={loading}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold hover:from-blue-500 hover:to-purple-500 disabled:opacity-50 transition-all"
            >
              {loading ? 'Connecting...' : 'Connect Wallet'}
            </button>
          </div>
        ) : pools.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-700 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-gray-400">No farming pools found</p>
            <p className="text-sm text-gray-500 mt-2">Check back later for new opportunities</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pools.map((pool) => {
              const userData = userPools.get(pool.pid) || {
                stakedAmount: 0n,
                pendingReward: 0n,
                lpBalance: 0n,
                allowance: 0n,
              };
              return (
                <FarmPoolCard
                  key={pool.pid}
                  pool={pool}
                  userStaked={userData.stakedAmount}
                  pendingReward={userData.pendingReward}
                  lpBalance={userData.lpBalance}
                  allowance={userData.allowance}
                  onApprove={() => approve(pool.pid)}
                  onDeposit={(amount) => deposit(pool.pid, amount)}
                  onWithdraw={(amount) => withdraw(pool.pid, amount)}
                  onHarvest={() => harvest(pool.pid)}
                  loading={loading}
                  isConnected={isConnected}
                  getTokenIcon={getTokenIcon}
                  getTokenColor={getTokenColor}
                  displaySymbol={displaySymbol}
                />
              );
            })}
          </div>
        )}

        {/* Refresh Button */}
        <div className="mt-6 text-center">
          <button
            onClick={refresh}
            disabled={loading}
            className="text-sm text-gray-400 hover:text-white disabled:opacity-50 transition-colors inline-flex items-center gap-2"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>
    </div>
  );
}
