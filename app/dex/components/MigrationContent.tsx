'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { type Address, formatUnits, parseUnits } from 'viem';
import { formatTokenAmount } from '@/lib/dex/hooks';
import { useTokenConfig } from '@/hooks/useTokenConfig';

// V1 Contract Addresses
const V1_PAIR_ADDRESS = '0x254a28924660FcB4f49F0A1Ffdb4378ea33A1863' as Address;
const V1_MASTERCHEF_ADDRESS = '0x0ec423a5C9471E3308690427366D795098f5f914' as Address;
const V1_POOL_ID = 0n; // V1 LP is in pool 0

// V2 Contract Addresses  
const V2_ROUTER_ADDRESS = '0xdD1Ae4345252FFEA67fE844296fbd6C973B98c18' as Address;
const V2_PAIR_ADDRESS = '0x3095069E8725402B43E6Ff127750E1246563e48a' as Address;

// Token Addresses
const WVBC_ADDRESS = '0x52CB9F0d65D9d4De08CF103153C7A1A97567Bb9b' as Address;
const VBCG_ADDRESS = '0xac7F60af25C5c4E23d1008C46511e265A8c9B6cF' as Address;

// V1 Pair ABI
const V1_PAIR_ABI = [
  {
    inputs: [{ type: 'address', name: '' }],
    name: 'balanceOf',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ type: 'address', name: 'to' }, { type: 'uint256', name: 'amount' }],
    name: 'transfer',
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getReserves',
    outputs: [{ type: 'uint256' }, { type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ type: 'address', name: 'to' }],
    name: 'burn',
    outputs: [{ type: 'uint256', name: 'amount0' }, { type: 'uint256', name: 'amount1' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// V2 Pair ABI (for getReserves)
const V2_PAIR_ABI = [
  {
    inputs: [],
    name: 'getReserves',
    outputs: [{ type: 'uint256' }, { type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token0',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// V2 Router ABI (no deadline!)
const V2_ROUTER_ABI = [
  {
    inputs: [
      { type: 'address', name: 'tokenA' },
      { type: 'address', name: 'tokenB' },
      { type: 'uint256', name: 'amountADesired' },
      { type: 'uint256', name: 'amountBDesired' },
      { type: 'uint256', name: 'amountAMin' },
      { type: 'uint256', name: 'amountBMin' },
      { type: 'address', name: 'to' },
    ],
    name: 'addLiquidity',
    outputs: [
      { type: 'uint256', name: 'amountA' },
      { type: 'uint256', name: 'amountB' },
      { type: 'uint256', name: 'liquidity' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// ERC20 ABI
const ERC20_ABI = [
  {
    inputs: [{ type: 'address', name: '' }],
    name: 'balanceOf',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ type: 'address', name: 'spender' }, { type: 'uint256', name: 'amount' }],
    name: 'approve',
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ type: 'address', name: 'owner' }, { type: 'address', name: 'spender' }],
    name: 'allowance',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// V1 MasterChef ABI
const V1_MASTERCHEF_ABI = [
  {
    inputs: [{ type: 'uint256', name: 'pid' }, { type: 'address', name: 'user' }],
    name: 'userInfo',
    outputs: [{ type: 'uint256', name: 'amount' }, { type: 'uint256', name: 'rewardDebt' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ type: 'uint256', name: 'pid' }, { type: 'address', name: 'user' }],
    name: 'pendingReward',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ type: 'uint256', name: 'pid' }, { type: 'uint256', name: 'amount' }],
    name: 'withdraw',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

type MigrationStep = 'idle' | 'unstake' | 'transfer' | 'burn' | 'approve-wvbc' | 'approve-vbcg' | 'add-liquidity' | 'complete';

interface MigrationState {
  step: MigrationStep;
  error: string | null;
  withdrawnWvbc: bigint;
  withdrawnVbcg: bigint;
}

export function MigrationContent() {
  const { address, isConnected } = useAccount();
  const { getTokenIcon, getTokenColor, displaySymbol } = useTokenConfig();
  
  const [migrationState, setMigrationState] = useState<MigrationState>({
    step: 'idle',
    error: null,
    withdrawnWvbc: 0n,
    withdrawnVbcg: 0n,
  });
  const [isStarted, setIsStarted] = useState(false);

  // Read V1 LP balance
  const { data: v1LpBalance, refetch: refetchV1Balance } = useReadContract({
    address: V1_PAIR_ADDRESS,
    abi: V1_PAIR_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  // Read V1 MasterChef staked balance
  const { data: v1StakedInfo, refetch: refetchV1Staked } = useReadContract({
    address: V1_MASTERCHEF_ADDRESS,
    abi: V1_MASTERCHEF_ABI,
    functionName: 'userInfo',
    args: address ? [V1_POOL_ID, address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  // Read V1 MasterChef pending rewards
  const { data: v1PendingReward, refetch: refetchV1Pending } = useReadContract({
    address: V1_MASTERCHEF_ADDRESS,
    abi: V1_MASTERCHEF_ABI,
    functionName: 'pendingReward',
    args: address ? [V1_POOL_ID, address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  // Extract staked amount from userInfo
  const v1StakedAmount = useMemo(() => {
    if (!v1StakedInfo) return 0n;
    return (v1StakedInfo as [bigint, bigint])[0];
  }, [v1StakedInfo]);

  // Total V1 LP (wallet + staked)
  const totalV1Lp = useMemo(() => {
    return (v1LpBalance || 0n) + v1StakedAmount;
  }, [v1LpBalance, v1StakedAmount]);

  // Read V1 total supply
  const { data: v1TotalSupply } = useReadContract({
    address: V1_PAIR_ADDRESS,
    abi: V1_PAIR_ABI,
    functionName: 'totalSupply',
    query: { enabled: !!address },
  });

  // Read V1 reserves
  const { data: v1Reserves } = useReadContract({
    address: V1_PAIR_ADDRESS,
    abi: V1_PAIR_ABI,
    functionName: 'getReserves',
    query: { enabled: !!address },
  });

  // Read V2 reserves
  const { data: v2Reserves } = useReadContract({
    address: V2_PAIR_ADDRESS,
    abi: V2_PAIR_ABI,
    functionName: 'getReserves',
    query: { enabled: true },
  });

  // Read WVBC balance
  const { data: wvbcBalance, refetch: refetchWvbc } = useReadContract({
    address: WVBC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });

  // Read VBCG balance
  const { data: vbcgBalance, refetch: refetchVbcg } = useReadContract({
    address: VBCG_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });

  // Read WVBC allowance
  const { data: wvbcAllowance, refetch: refetchWvbcAllowance } = useReadContract({
    address: WVBC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, V2_ROUTER_ADDRESS] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });

  // Read VBCG allowance
  const { data: vbcgAllowance, refetch: refetchVbcgAllowance } = useReadContract({
    address: VBCG_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, V2_ROUTER_ADDRESS] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });

  // Write contract hooks
  const { writeContract, data: txHash, isPending, error: writeError, reset: resetWrite } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  // Calculate expected withdrawal from V1 (using total V1 LP)
  const expectedWithdrawal = useMemo(() => {
    if (!totalV1Lp || !v1TotalSupply || !v1Reserves || v1TotalSupply === 0n) {
      return { wvbc: 0n, vbcg: 0n };
    }
    const [reserve0, reserve1] = v1Reserves as [bigint, bigint];
    const userShare = (totalV1Lp * BigInt(1e18)) / v1TotalSupply;
    return {
      wvbc: (reserve0 * userShare) / BigInt(1e18),
      vbcg: (reserve1 * userShare) / BigInt(1e18),
    };
  }, [totalV1Lp, v1TotalSupply, v1Reserves]);

  // Calculate V2 addition amounts based on V2 ratio
  const v2AdditionAmounts = useMemo(() => {
    const wvbc = migrationState.withdrawnWvbc > 0n ? migrationState.withdrawnWvbc : expectedWithdrawal.wvbc;
    const vbcg = migrationState.withdrawnVbcg > 0n ? migrationState.withdrawnVbcg : expectedWithdrawal.vbcg;
    
    if (!v2Reserves || wvbc === 0n || vbcg === 0n) {
      return { wvbcToAdd: 0n, vbcgToAdd: 0n, remainingWvbc: 0n, remainingVbcg: 0n };
    }

    const [v2Reserve0, v2Reserve1] = v2Reserves as [bigint, bigint];
    if (v2Reserve0 === 0n) {
      return { wvbcToAdd: wvbc, vbcgToAdd: vbcg, remainingWvbc: 0n, remainingVbcg: 0n };
    }

    // Calculate based on V2 ratio
    const vbcgNeeded = (wvbc * v2Reserve1) / v2Reserve0;
    
    let wvbcToAdd: bigint;
    let vbcgToAdd: bigint;
    
    if (vbcgNeeded <= vbcg) {
      // Enough VBCG, use all WVBC
      wvbcToAdd = wvbc;
      vbcgToAdd = vbcgNeeded;
    } else {
      // Not enough VBCG, reduce WVBC
      vbcgToAdd = vbcg;
      wvbcToAdd = (vbcg * v2Reserve0) / v2Reserve1;
    }

    return {
      wvbcToAdd,
      vbcgToAdd,
      remainingWvbc: wvbc - wvbcToAdd,
      remainingVbcg: vbcg - vbcgToAdd,
    };
  }, [v2Reserves, migrationState.withdrawnWvbc, migrationState.withdrawnVbcg, expectedWithdrawal]);

  // Handle transaction confirmation
  useEffect(() => {
    if (isConfirmed && isStarted) {
      const handleConfirmation = async () => {
        switch (migrationState.step) {
          case 'unstake':
            // Refetch V1 LP balance after unstake
            await Promise.all([refetchV1Balance(), refetchV1Staked(), refetchV1Pending()]);
            setMigrationState(prev => ({ ...prev, step: 'transfer', error: null }));
            resetWrite();
            break;
          case 'transfer':
            // Move to burn step
            setMigrationState(prev => ({ ...prev, step: 'burn', error: null }));
            resetWrite();
            break;
          case 'burn':
            // Refetch balances and move to approve
            await Promise.all([refetchWvbc(), refetchVbcg()]);
            // Get the actual withdrawn amounts from current balances
            const newWvbc = wvbcBalance as bigint || 0n;
            const newVbcg = vbcgBalance as bigint || 0n;
            setMigrationState(prev => ({
              ...prev,
              step: 'approve-wvbc',
              error: null,
              withdrawnWvbc: newWvbc,
              withdrawnVbcg: newVbcg,
            }));
            resetWrite();
            break;
          case 'approve-wvbc':
            await refetchWvbcAllowance();
            setMigrationState(prev => ({ ...prev, step: 'approve-vbcg', error: null }));
            resetWrite();
            break;
          case 'approve-vbcg':
            await refetchVbcgAllowance();
            setMigrationState(prev => ({ ...prev, step: 'add-liquidity', error: null }));
            resetWrite();
            break;
          case 'add-liquidity':
            await Promise.all([refetchV1Balance(), refetchWvbc(), refetchVbcg()]);
            setMigrationState(prev => ({ ...prev, step: 'complete', error: null }));
            setIsStarted(false);
            resetWrite();
            break;
        }
      };
      handleConfirmation();
    }
  }, [isConfirmed, isStarted, migrationState.step, resetWrite, refetchWvbc, refetchVbcg, refetchWvbcAllowance, refetchVbcgAllowance, refetchV1Balance, refetchV1Staked, refetchV1Pending, wvbcBalance, vbcgBalance]);

  // Auto-execute next step
  useEffect(() => {
    if (!isStarted || isPending || isConfirming || migrationState.error) return;

    const executeStep = async () => {
      try {
        switch (migrationState.step) {
          case 'unstake':
            if (v1StakedAmount > 0n) {
              writeContract({
                address: V1_MASTERCHEF_ADDRESS,
                abi: V1_MASTERCHEF_ABI,
                functionName: 'withdraw',
                args: [V1_POOL_ID, v1StakedAmount],
              });
            } else {
              // Skip to transfer if nothing staked
              setMigrationState(prev => ({ ...prev, step: 'transfer', error: null }));
            }
            break;
          case 'transfer':
            if (v1LpBalance && v1LpBalance > 0n) {
              writeContract({
                address: V1_PAIR_ADDRESS,
                abi: V1_PAIR_ABI,
                functionName: 'transfer',
                args: [V1_PAIR_ADDRESS, v1LpBalance],
              });
            }
            break;
          case 'burn':
            if (address) {
              writeContract({
                address: V1_PAIR_ADDRESS,
                abi: V1_PAIR_ABI,
                functionName: 'burn',
                args: [address],
              });
            }
            break;
          case 'approve-wvbc':
            writeContract({
              address: WVBC_ADDRESS,
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [V2_ROUTER_ADDRESS, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
            });
            break;
          case 'approve-vbcg':
            writeContract({
              address: VBCG_ADDRESS,
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [V2_ROUTER_ADDRESS, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
            });
            break;
          case 'add-liquidity':
            if (address && v2AdditionAmounts.wvbcToAdd > 0n && v2AdditionAmounts.vbcgToAdd > 0n) {
              const minWvbc = (v2AdditionAmounts.wvbcToAdd * 95n) / 100n;
              const minVbcg = (v2AdditionAmounts.vbcgToAdd * 95n) / 100n;
              writeContract({
                address: V2_ROUTER_ADDRESS,
                abi: V2_ROUTER_ABI,
                functionName: 'addLiquidity',
                args: [
                  WVBC_ADDRESS,
                  VBCG_ADDRESS,
                  v2AdditionAmounts.wvbcToAdd,
                  v2AdditionAmounts.vbcgToAdd,
                  minWvbc,
                  minVbcg,
                  address,
                ],
              });
            }
            break;
        }
      } catch (err) {
        setMigrationState(prev => ({
          ...prev,
          error: err instanceof Error ? err.message : 'Unknown error',
        }));
      }
    };

    if (migrationState.step !== 'idle' && migrationState.step !== 'complete') {
      executeStep();
    }
  }, [migrationState.step, isStarted, isPending, isConfirming, migrationState.error, v1LpBalance, v1StakedAmount, address, v2AdditionAmounts, writeContract]);

  // Handle write errors
  useEffect(() => {
    if (writeError) {
      setMigrationState(prev => ({
        ...prev,
        error: writeError.message,
      }));
    }
  }, [writeError]);

  const startMigration = useCallback(() => {
    setIsStarted(true);
    // Start with unstake if user has staked LP, otherwise start with transfer
    const firstStep = v1StakedAmount > 0n ? 'unstake' : 'transfer';
    setMigrationState({
      step: firstStep,
      error: null,
      withdrawnWvbc: 0n,
      withdrawnVbcg: 0n,
    });
  }, [v1StakedAmount]);

  const retryStep = useCallback(() => {
    setMigrationState(prev => ({ ...prev, error: null }));
    resetWrite();
  }, [resetWrite]);

  const resetMigration = useCallback(() => {
    setIsStarted(false);
    setMigrationState({
      step: 'idle',
      error: null,
      withdrawnWvbc: 0n,
      withdrawnVbcg: 0n,
    });
    resetWrite();
  }, [resetWrite]);

  const hasV1Lp = totalV1Lp > 0n;
  const hasStakedLp = v1StakedAmount > 0n;

  // Build steps based on whether user has staked LP
  const steps = useMemo(() => {
    const baseSteps = [
      { id: 'transfer', label: 'Transfer LP to V1 Pair', description: 'Send LP tokens to pair contract' },
      { id: 'burn', label: 'Burn V1 LP', description: 'Receive WVBC and VBCG' },
      { id: 'approve-wvbc', label: 'Approve WVBC', description: 'Allow V2 Router to use WVBC' },
      { id: 'approve-vbcg', label: 'Approve VBCG', description: 'Allow V2 Router to use VBCG' },
      { id: 'add-liquidity', label: 'Add V2 Liquidity', description: 'Create new LP in V2' },
    ];
    if (hasStakedLp) {
      return [
        { id: 'unstake', label: 'Unstake from V1 Farm', description: 'Withdraw LP + harvest rewards' },
        ...baseSteps,
      ];
    }
    return baseSteps;
  }, [hasStakedLp]);

  const getStepStatus = (stepId: string) => {
    const stepOrder = hasStakedLp 
      ? ['unstake', 'transfer', 'burn', 'approve-wvbc', 'approve-vbcg', 'add-liquidity']
      : ['transfer', 'burn', 'approve-wvbc', 'approve-vbcg', 'add-liquidity'];
    const currentIndex = stepOrder.indexOf(migrationState.step);
    const stepIndex = stepOrder.indexOf(stepId);
    
    if (migrationState.step === 'complete') return 'complete';
    if (stepIndex < currentIndex) return 'complete';
    if (stepIndex === currentIndex) return migrationState.error ? 'error' : 'active';
    return 'pending';
  };

  if (!isConnected) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-gray-700/50 text-center">
          <h2 className="text-xl font-bold text-white mb-4">V1 → V2 Migration</h2>
          <p className="text-gray-400">Please connect your wallet to check for V1 LP tokens.</p>
        </div>
      </div>
    );
  }

  if (!hasV1Lp && migrationState.step !== 'complete') {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-gray-700/50 text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-green-500/20 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">No V1 LP Found</h2>
          <p className="text-gray-400">You don&apos;t have any V1 LP tokens to migrate.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Header Card */}
      <div className="bg-gradient-to-b from-orange-900/30 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-orange-500/30">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-orange-500/20 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">V1 → V2 Migration</h2>
            <p className="text-sm text-orange-400">Migrate your liquidity to the new pool</p>
          </div>
        </div>

        {/* V1 LP Balance - Wallet */}
        <div className="bg-gray-800/60 rounded-xl p-4 mb-3">
          <div className="flex justify-between items-center">
            <span className="text-gray-400">V1 LP in Wallet</span>
            <span className="text-lg font-bold text-white">
              {formatTokenAmount(v1LpBalance || 0n, 18, 6)} LP
            </span>
          </div>
        </div>

        {/* V1 LP Balance - Staked */}
        {hasStakedLp && (
          <div className="bg-green-900/30 rounded-xl p-4 mb-3 border border-green-500/30">
            <div className="flex justify-between items-center">
              <span className="text-green-400">V1 LP Staked in Farm</span>
              <span className="text-lg font-bold text-green-300">
                {formatTokenAmount(v1StakedAmount, 18, 6)} LP
              </span>
            </div>
            {v1PendingReward && v1PendingReward > 0n && (
              <div className="flex justify-between items-center mt-2 pt-2 border-t border-green-500/20">
                <span className="text-green-400 text-sm">Pending Rewards</span>
                <span className="text-yellow-400 font-semibold">
                  {formatTokenAmount(v1PendingReward as bigint, 18, 4)} tokens
                </span>
              </div>
            )}
          </div>
        )}

        {/* Total V1 LP */}
        {hasStakedLp && (
          <div className="bg-gray-800/60 rounded-xl p-4 mb-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-400 font-semibold">Total V1 LP</span>
              <span className="text-xl font-bold text-white">
                {formatTokenAmount(totalV1Lp, 18, 6)} LP
              </span>
            </div>
          </div>
        )}

        {/* Expected Withdrawal */}
        <div className="bg-gray-800/60 rounded-xl p-4 space-y-2">
          <div className="text-sm text-gray-400 mb-2">Expected to receive from V1:</div>
          <div className="flex justify-between">
            <span className="text-gray-300">WVBC</span>
            <span className="text-green-400 font-semibold">{formatTokenAmount(expectedWithdrawal.wvbc, 18, 4)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-300">VBCG</span>
            <span className="text-yellow-400 font-semibold">{formatTokenAmount(expectedWithdrawal.vbcg, 18, 4)}</span>
          </div>
        </div>
      </div>

      {/* V2 Addition Preview */}
      {(expectedWithdrawal.wvbc > 0n || migrationState.withdrawnWvbc > 0n) && (
        <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-gray-700/50">
          <h3 className="text-lg font-semibold text-white mb-4">V2 Pool Addition</h3>
          
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-400">WVBC to add</span>
              <span className="text-green-400 font-semibold">{formatTokenAmount(v2AdditionAmounts.wvbcToAdd, 18, 4)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">VBCG to add</span>
              <span className="text-yellow-400 font-semibold">{formatTokenAmount(v2AdditionAmounts.vbcgToAdd, 18, 4)}</span>
            </div>
            
            {(v2AdditionAmounts.remainingWvbc > 0n || v2AdditionAmounts.remainingVbcg > 0n) && (
              <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="text-sm text-yellow-400 mb-2">⚠️ Remaining tokens (due to price ratio difference):</div>
                {v2AdditionAmounts.remainingWvbc > 0n && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">WVBC</span>
                    <span className="text-yellow-300">{formatTokenAmount(v2AdditionAmounts.remainingWvbc, 18, 4)}</span>
                  </div>
                )}
                {v2AdditionAmounts.remainingVbcg > 0n && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">VBCG</span>
                    <span className="text-yellow-300">{formatTokenAmount(v2AdditionAmounts.remainingVbcg, 18, 4)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Migration Steps */}
      {isStarted && (
        <div className="bg-gradient-to-b from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-gray-700/50">
          <h3 className="text-lg font-semibold text-white mb-4">Migration Progress</h3>
          
          <div className="space-y-3">
            {steps.map((step, index) => {
              const status = getStepStatus(step.id);
              return (
                <div key={step.id} className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    status === 'complete' ? 'bg-green-500' :
                    status === 'active' ? 'bg-blue-500 animate-pulse' :
                    status === 'error' ? 'bg-red-500' :
                    'bg-gray-600'
                  }`}>
                    {status === 'complete' ? (
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : status === 'error' ? (
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    ) : (
                      <span className="text-white text-sm font-bold">{index + 1}</span>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className={`font-medium ${status === 'active' ? 'text-blue-400' : status === 'complete' ? 'text-green-400' : status === 'error' ? 'text-red-400' : 'text-gray-400'}`}>
                      {step.label}
                    </div>
                    <div className="text-xs text-gray-500">{step.description}</div>
                  </div>
                  {status === 'active' && (isPending || isConfirming) && (
                    <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Error Display */}
          {migrationState.error && (
            <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
              <p className="text-red-400 text-sm mb-3">{migrationState.error}</p>
              <button
                onClick={retryStep}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-semibold transition-colors"
              >
                Retry Step
              </button>
            </div>
          )}

          {/* Completion */}
          {migrationState.step === 'complete' && (
            <div className="mt-4 p-4 bg-green-500/10 border border-green-500/30 rounded-xl text-center">
              <div className="w-12 h-12 mx-auto mb-3 bg-green-500/20 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-green-400 font-semibold">Migration Complete!</p>
              <p className="text-gray-400 text-sm mt-1">Your liquidity has been migrated to V2.</p>
            </div>
          )}
        </div>
      )}

      {/* Warning */}
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
        <div className="flex gap-3">
          <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="text-sm">
            <p className="text-red-400 font-semibold mb-1">Important:</p>
            <ul className="text-gray-400 space-y-1 list-disc list-inside">
              <li>This migration cannot be reversed</li>
              <li>V1 does not support approve/transferFrom</li>
              <li>Do not close this page during migration</li>
              <li>Remaining tokens will stay in your wallet</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Action Button */}
      {!isStarted && hasV1Lp && (
        <button
          onClick={startMigration}
          className="w-full py-4 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-2xl font-bold text-lg transition-all shadow-lg shadow-orange-500/25"
        >
          Start Migration
        </button>
      )}

      {isStarted && migrationState.step !== 'complete' && !migrationState.error && (
        <button
          disabled
          className="w-full py-4 bg-gray-600 text-gray-400 rounded-2xl font-bold text-lg cursor-not-allowed"
        >
          Migration in Progress...
        </button>
      )}

      {migrationState.step === 'complete' && (
        <button
          onClick={resetMigration}
          className="w-full py-4 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white rounded-2xl font-bold text-lg transition-all"
        >
          Done
        </button>
      )}
    </div>
  );
}

export default MigrationContent;
