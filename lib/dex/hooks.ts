'use client';

import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount, useBalance } from 'wagmi';
import { parseEther, formatEther, formatUnits, parseUnits, type Address } from 'viem';
import { DEX_CONTRACTS, ROUTER_ABI, FACTORY_ABI, PAIR_ABI, ERC20_ABI, type Token, VBC_TOKEN, WVBC_TOKEN } from './config';

// ============================================
// Utility Functions
// ============================================

export function isNativeToken(token: Token): boolean {
  return token.address === '0x0000000000000000000000000000000000000000';
}

export function getTokenAddress(token: Token): Address {
  return isNativeToken(token) ? DEX_CONTRACTS.wvbc : token.address;
}

export function formatTokenAmount(amount: bigint, decimals: number = 18, displayDecimals: number = 6): string {
  const formatted = formatUnits(amount, decimals);
  const num = parseFloat(formatted);
  if (num === 0) return '0';
  if (num < 0.000001) return '< 0.000001';
  return num.toLocaleString('en-US', {
    maximumFractionDigits: displayDecimals,
    minimumFractionDigits: 0,
  });
}

export function parseTokenAmount(amount: string, decimals: number = 18): bigint {
  try {
    return parseUnits(amount, decimals);
  } catch {
    return 0n;
  }
}

export function calculateMinAmount(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10000 - slippageBps)) / 10000n;
}

export function calculatePriceImpact(
  amountIn: bigint,
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint
): number {
  if (reserveIn === 0n || reserveOut === 0n || amountIn === 0n) return 0;
  
  const spotPrice = Number(reserveOut) / Number(reserveIn);
  const executionPrice = Number(amountOut) / Number(amountIn);
  const priceImpact = ((spotPrice - executionPrice) / spotPrice) * 100;
  
  return Math.max(0, priceImpact);
}

// ============================================
// Custom Hooks
// ============================================

// Get native VBC balance
export function useVBCBalance(address?: Address) {
  return useBalance({
    address,
  });
}

// Get ERC20 token balance
export function useTokenBalance(tokenAddress: Address, userAddress?: Address) {
  return useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!userAddress && tokenAddress !== '0x0000000000000000000000000000000000000000',
    },
  });
}

// Get token allowance
export function useTokenAllowance(tokenAddress: Address, owner?: Address, spender?: Address) {
  return useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: owner && spender ? [owner, spender] : undefined,
    query: {
      enabled: !!owner && !!spender && tokenAddress !== '0x0000000000000000000000000000000000000000',
    },
  });
}

// Get pair address
export function usePairAddress(tokenA: Address, tokenB: Address) {
  return useReadContract({
    address: DEX_CONTRACTS.factory,
    abi: FACTORY_ABI,
    functionName: 'getPair',
    args: [tokenA, tokenB],
    query: {
      enabled: tokenA !== tokenB,
    },
  });
}

// Get reserves from router
export function useReserves(tokenA: Address, tokenB: Address) {
  return useReadContract({
    address: DEX_CONTRACTS.router,
    abi: ROUTER_ABI,
    functionName: 'getReserves',
    args: [tokenA, tokenB],
    query: {
      enabled: tokenA !== tokenB,
    },
  });
}

// Get swap quote
export function useSwapQuote(amountIn: bigint, path: Address[]) {
  return useReadContract({
    address: DEX_CONTRACTS.router,
    abi: ROUTER_ABI,
    functionName: 'getAmountsOut',
    args: [amountIn, path],
    query: {
      enabled: amountIn > 0n && path.length >= 2,
    },
  });
}

// Get pair info
export function usePairInfo(pairAddress?: Address) {
  const { data: token0 } = useReadContract({
    address: pairAddress,
    abi: PAIR_ABI,
    functionName: 'token0',
    query: { enabled: !!pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000' },
  });

  const { data: token1 } = useReadContract({
    address: pairAddress,
    abi: PAIR_ABI,
    functionName: 'token1',
    query: { enabled: !!pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000' },
  });

  const { data: reserves } = useReadContract({
    address: pairAddress,
    abi: PAIR_ABI,
    functionName: 'getReserves',
    query: { enabled: !!pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000' },
  });

  const { data: totalSupply } = useReadContract({
    address: pairAddress,
    abi: PAIR_ABI,
    functionName: 'totalSupply',
    query: { enabled: !!pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000' },
  });

  return {
    token0: token0 as Address | undefined,
    token1: token1 as Address | undefined,
    reserve0: reserves?.[0] as bigint | undefined,
    reserve1: reserves?.[1] as bigint | undefined,
    totalSupply: totalSupply as bigint | undefined,
  };
}

// Get user LP balance
export function useUserLPBalance(pairAddress?: Address, userAddress?: Address) {
  return useReadContract({
    address: pairAddress,
    abi: PAIR_ABI,
    functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!pairAddress && !!userAddress && pairAddress !== '0x0000000000000000000000000000000000000000',
    },
  });
}

// Get all pairs count
export function useAllPairsLength() {
  return useReadContract({
    address: DEX_CONTRACTS.factory,
    abi: FACTORY_ABI,
    functionName: 'allPairsLength',
  });
}

// Get pair by index
export function usePairByIndex(index: bigint) {
  return useReadContract({
    address: DEX_CONTRACTS.factory,
    abi: FACTORY_ABI,
    functionName: 'allPairs',
    args: [index],
  });
}

// ============================================
// Write Hooks
// ============================================

export function useApproveToken() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const approve = async (tokenAddress: Address, spender: Address, amount: bigint) => {
    return writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, amount],
    });
  };

  return { approve, hash, isPending, isConfirming, isSuccess, error };
}

export function useSwap() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // VBC -> Token
  const swapVBCForTokens = async (
    amountIn: bigint,
    amountOutMin: bigint,
    path: Address[],
    to: Address
  ) => {
    return writeContract({
      address: DEX_CONTRACTS.router,
      abi: ROUTER_ABI,
      functionName: 'swapExactVBCForTokens',
      args: [amountOutMin, path, to],
      value: amountIn,
    });
  };

  // Token -> VBC
  const swapTokensForVBC = async (
    amountIn: bigint,
    amountOutMin: bigint,
    path: Address[],
    to: Address
  ) => {
    return writeContract({
      address: DEX_CONTRACTS.router,
      abi: ROUTER_ABI,
      functionName: 'swapExactTokensForVBC',
      args: [amountIn, amountOutMin, path, to],
    });
  };

  // Token -> Token
  const swapTokensForTokens = async (
    amountIn: bigint,
    amountOutMin: bigint,
    path: Address[],
    to: Address
  ) => {
    return writeContract({
      address: DEX_CONTRACTS.router,
      abi: ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [amountIn, amountOutMin, path, to],
    });
  };

  return {
    swapVBCForTokens,
    swapTokensForVBC,
    swapTokensForTokens,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

export function useAddLiquidity() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // Add liquidity for VBC + Token pair
  const addLiquidityVBC = async (
    token: Address,
    amountTokenDesired: bigint,
    amountTokenMin: bigint,
    amountVBCMin: bigint,
    to: Address,
    amountVBC: bigint
  ) => {
    return writeContract({
      address: DEX_CONTRACTS.router,
      abi: ROUTER_ABI,
      functionName: 'addLiquidityVBC',
      args: [token, amountTokenDesired, amountTokenMin, amountVBCMin, to],
      value: amountVBC,
    });
  };

  // Add liquidity for Token + Token pair
  const addLiquidity = async (
    tokenA: Address,
    tokenB: Address,
    amountADesired: bigint,
    amountBDesired: bigint,
    amountAMin: bigint,
    amountBMin: bigint,
    to: Address
  ) => {
    return writeContract({
      address: DEX_CONTRACTS.router,
      abi: ROUTER_ABI,
      functionName: 'addLiquidity',
      args: [tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, to],
    });
  };

  return { addLiquidityVBC, addLiquidity, hash, isPending, isConfirming, isSuccess, error };
}

export function useRemoveLiquidity() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // Remove liquidity for VBC + Token pair
  const removeLiquidityVBC = async (
    token: Address,
    liquidity: bigint,
    amountTokenMin: bigint,
    amountVBCMin: bigint,
    to: Address
  ) => {
    return writeContract({
      address: DEX_CONTRACTS.router,
      abi: ROUTER_ABI,
      functionName: 'removeLiquidityVBC',
      args: [token, liquidity, amountTokenMin, amountVBCMin, to],
    });
  };

  // Remove liquidity for Token + Token pair
  const removeLiquidity = async (
    tokenA: Address,
    tokenB: Address,
    liquidity: bigint,
    amountAMin: bigint,
    amountBMin: bigint,
    to: Address
  ) => {
    return writeContract({
      address: DEX_CONTRACTS.router,
      abi: ROUTER_ABI,
      functionName: 'removeLiquidity',
      args: [tokenA, tokenB, liquidity, amountAMin, amountBMin, to],
    });
  };

  return { removeLiquidityVBC, removeLiquidity, hash, isPending, isConfirming, isSuccess, error };
}

// Approve LP tokens for removal
export function useApproveLPToken() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const approve = async (pairAddress: Address, amount: bigint) => {
    return writeContract({
      address: pairAddress,
      abi: PAIR_ABI,
      functionName: 'approve',
      args: [DEX_CONTRACTS.router, amount],
    });
  };

  return { approve, hash, isPending, isConfirming, isSuccess, error };
}
