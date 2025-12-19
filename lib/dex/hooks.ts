'use client';

import { useMemo } from 'react';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount, useBalance } from 'wagmi';
import { parseEther, formatEther, formatUnits, parseUnits, type Address } from 'viem';
import { getDexContracts, ROUTER_ABI, FACTORY_ABI, PAIR_ABI, ERC20_ABI, type Token, getNativeToken, getWrappedNativeToken } from './config';

// Generic token exports (dynamically loaded from config)
export const NATIVE_TOKEN = getNativeToken();
export const WRAPPED_NATIVE_TOKEN = getWrappedNativeToken();

// ============================================
// Utility Functions
// ============================================

export function isNativeToken(token: Token): boolean {
  return token.address === '0x0000000000000000000000000000000000000000';
}

export function getTokenAddress(token: Token): Address {
  const contracts = getDexContracts();
  return isNativeToken(token) ? contracts.wrappedNative : token.address;
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

// Get native token balance (ETH, VBC, BNB, etc.)
export function useNativeBalance(address?: Address) {
  return useBalance({
    address,
  });
}

// Legacy alias for backward compatibility
export const useVBCBalance = useNativeBalance;

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
  const contracts = getDexContracts();
  return useReadContract({
    address: contracts.factory,
    abi: FACTORY_ABI,
    functionName: 'getPair',
    args: [tokenA, tokenB],
    query: {
      enabled: tokenA !== tokenB,
    },
  });
}

// Get reserves from pair (in the same order as tokenA/tokenB)
export function useReserves(tokenA: Address, tokenB: Address) {
  const { data: pairAddress } = usePairAddress(tokenA, tokenB);
  const pair = pairAddress as Address | undefined;
  const enabled =
    tokenA !== tokenB &&
    !!pair &&
    pair !== '0x0000000000000000000000000000000000000000';

  const { data: token0 } = useReadContract({
    address: pair,
    abi: PAIR_ABI,
    functionName: 'token0',
    query: { enabled },
  });

  const { data: rawReserves, ...rest } = useReadContract({
    address: pair,
    abi: PAIR_ABI,
    functionName: 'getReserves',
    query: { enabled },
  });

  const data = useMemo(() => {
    if (!rawReserves || !token0) return undefined;
    const [reserve0, reserve1] = rawReserves as unknown as readonly [bigint, bigint];
    const token0Addr = (token0 as string).toLowerCase();
    const tokenAAddr = tokenA.toLowerCase();

    return tokenAAddr === token0Addr
      ? ([reserve0, reserve1] as const)
      : ([reserve1, reserve0] as const);
  }, [rawReserves, token0, tokenA]);

  return { data, ...rest };
}

// Get swap quote
export function useSwapQuote(amountIn: bigint, path: Address[]) {
  const contracts = getDexContracts();
  return useReadContract({
    address: contracts.router,
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
  const contracts = getDexContracts();
  return useReadContract({
    address: contracts.factory,
    abi: FACTORY_ABI,
    functionName: 'allPairsLength',
  });
}

// Get pair by index
export function usePairByIndex(index: bigint) {
  const contracts = getDexContracts();
  return useReadContract({
    address: contracts.factory,
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
  const contracts = getDexContracts();

  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 60 * 20); // 20 minutes

  // Native -> Token (ETH/VBC/BNB -> Token)
  const swapNativeForTokens = async (
    amountIn: bigint,
    amountOutMin: bigint,
    path: Address[],
    to: Address
  ) => {
    try {
      // VirBiCoin系Router
      return await writeContract({
        address: contracts.router,
        abi: ROUTER_ABI,
        functionName: 'swapExactVBCForTokens',
        args: [amountOutMin, path, to],
        value: amountIn,
      });
    } catch {
      // 標準UniswapV2 (deadline有り)
      return writeContract({
        address: contracts.router,
        abi: ROUTER_ABI,
        functionName: 'swapExactETHForTokens',
        args: [amountOutMin, path, to, deadline()],
        value: amountIn,
      });
    }
  };

  // Token -> Native (Token -> ETH/VBC/BNB)
  const swapTokensForNative = async (
    amountIn: bigint,
    amountOutMin: bigint,
    path: Address[],
    to: Address
  ) => {
    try {
      // VirBiCoin系Router
      return await writeContract({
        address: contracts.router,
        abi: ROUTER_ABI,
        functionName: 'swapExactTokensForVBC',
        args: [amountIn, amountOutMin, path, to],
      });
    } catch {
      // 標準UniswapV2 (deadline有り)
      return writeContract({
        address: contracts.router,
        abi: ROUTER_ABI,
        functionName: 'swapExactTokensForETH',
        args: [amountIn, amountOutMin, path, to, deadline()],
      });
    }
  };

  // Token -> Token
  const swapTokensForTokens = async (
    amountIn: bigint,
    amountOutMin: bigint,
    path: Address[],
    to: Address
  ) => {
    try {
      // deadline無し版
      return await writeContract({
        address: contracts.router,
        abi: ROUTER_ABI,
        functionName: 'swapExactTokensForTokens',
        args: [amountIn, amountOutMin, path, to],
      });
    } catch {
      // 標準UniswapV2 (deadline有り)
      return writeContract({
        address: contracts.router,
        abi: ROUTER_ABI,
        functionName: 'swapExactTokensForTokens',
        args: [amountIn, amountOutMin, path, to, deadline()],
      });
    }
  };

  // Legacy aliases for backward compatibility
  const swapVBCForTokens = swapNativeForTokens;
  const swapTokensForVBC = swapTokensForNative;

  return {
    swapNativeForTokens,
    swapTokensForNative,
    swapTokensForTokens,
    // Legacy exports
    swapVBCForTokens,
    swapTokensForVBC,
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
  const contracts = getDexContracts();

  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 60 * 20); // 20 minutes

  // Add liquidity for Native + Token pair (ETH/VBC/BNB + Token)
  const addLiquidityNative = async (
    token: Address,
    amountTokenDesired: bigint,
    amountTokenMin: bigint,
    amountNativeMin: bigint,
    to: Address,
    amountNative: bigint
  ) => {
    try {
      // VirBiCoin系Router
      return await writeContract({
        address: contracts.router,
        abi: ROUTER_ABI,
        functionName: 'addLiquidityVBC',
        args: [token, amountTokenDesired, amountTokenMin, amountNativeMin, to],
        value: amountNative,
      });
    } catch {
      // 標準UniswapV2 (deadline有り)
      return writeContract({
        address: contracts.router,
        abi: ROUTER_ABI,
        functionName: 'addLiquidityETH',
        args: [token, amountTokenDesired, amountTokenMin, amountNativeMin, to, deadline()],
        value: amountNative,
      });
    }
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
    try {
      // deadline無し版
      return await writeContract({
        address: contracts.router,
        abi: ROUTER_ABI,
        functionName: 'addLiquidity',
        args: [tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, to],
      });
    } catch {
      // 標準UniswapV2 (deadline有り)
      return writeContract({
        address: contracts.router,
        abi: ROUTER_ABI,
        functionName: 'addLiquidity',
        args: [tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, to, deadline()],
      });
    }
  };

  // Legacy alias for backward compatibility
  const addLiquidityVBC = addLiquidityNative;

  return { addLiquidityNative, addLiquidityVBC, addLiquidity, hash, isPending, isConfirming, isSuccess, error };
}

// Transfer LP tokens to pair for burning
export function useTransferLPToPair() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const transferToPair = async (pairAddress: Address, amount: bigint) => {
    return writeContract({
      address: pairAddress,
      abi: PAIR_ABI,
      functionName: 'transfer',
      args: [pairAddress, amount],
    });
  };

  return { transferToPair, hash, isPending, isConfirming, isSuccess, error };
}

// Burn LP tokens from pair to get underlying tokens
export function useBurnLP() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const burn = async (pairAddress: Address, to: Address) => {
    return writeContract({
      address: pairAddress,
      abi: PAIR_ABI,
      functionName: 'burn',
      args: [to],
    });
  };

  return { burn, hash, isPending, isConfirming, isSuccess, error };
}

export function useRemoveLiquidity() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const contracts = getDexContracts();

  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 60 * 20); // 20 minutes

  // Remove liquidity for Native + Token pair (ETH/VBC/BNB + Token)
  const removeLiquidityNative = async (
    token: Address,
    liquidity: bigint,
    amountTokenMin: bigint,
    amountNativeMin: bigint,
    to: Address
  ) => {
    try {
      // VirBiCoin系Router
      return await writeContract({
        address: contracts.router,
        abi: ROUTER_ABI,
        functionName: 'removeLiquidityVBC',
        args: [token, liquidity, amountTokenMin, amountNativeMin, to],
      });
    } catch {
      // 標準UniswapV2 (deadline有り)
      return writeContract({
        address: contracts.router,
        abi: ROUTER_ABI,
        functionName: 'removeLiquidityETH',
        args: [token, liquidity, amountTokenMin, amountNativeMin, to, deadline()],
      });
    }
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
    try {
      // deadline無し版
      return await writeContract({
        address: contracts.router,
        abi: ROUTER_ABI,
        functionName: 'removeLiquidity',
        args: [tokenA, tokenB, liquidity, amountAMin, amountBMin, to],
      });
    } catch {
      // 標準UniswapV2 (deadline有り)
      return writeContract({
        address: contracts.router,
        abi: ROUTER_ABI,
        functionName: 'removeLiquidity',
        args: [tokenA, tokenB, liquidity, amountAMin, amountBMin, to, deadline()],
      });
    }
  };

  // Legacy alias for backward compatibility
  const removeLiquidityVBC = removeLiquidityNative;

  return { removeLiquidityNative, removeLiquidityVBC, removeLiquidity, hash, isPending, isConfirming, isSuccess, error };
}

// Approve LP tokens for removal (kept for compatibility but may not work with this contract)
export function useApproveLPToken() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const contracts = getDexContracts();

  const approve = async (pairAddress: Address, amount: bigint) => {
    return writeContract({
      address: pairAddress,
      abi: PAIR_ABI,
      functionName: 'approve',
      args: [contracts.router, amount],
    });
  };

  return { approve, hash, isPending, isConfirming, isSuccess, error };
}
