// DEX Configuration - Generic EVM Chain Support
// Uses minimal static config + dynamic loading from blockchain
// All chain-specific values come from config.json

import { defineChain, type Chain } from 'viem';
import { getMinimalConfig, type MinimalConfig } from './contract-service';

// Type for dynamic chain definition
export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorer: string;
  currency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

// Create chain definition dynamically from config
export function createChain(config: ChainConfig): Chain {
  // Ensure all values are proper types for viem
  const chainId = typeof config.chainId === 'bigint' 
    ? Number(config.chainId)
    : Number(config.chainId) || 1;
  const decimals = typeof config.currency.decimals === 'bigint' 
    ? Number(config.currency.decimals)
    : Number(config.currency.decimals) || 18;
    
  return defineChain({
    id: chainId,
    name: config.name,
    nativeCurrency: {
      name: config.currency.name,
      symbol: config.currency.symbol,
      decimals: decimals,
    },
    rpcUrls: {
      default: {
        http: [config.rpcUrl],
      },
      public: {
        http: [config.rpcUrl],
      },
    },
    blockExplorers: {
      default: {
        name: `${config.name} Explorer`,
        url: config.explorer,
      },
    },
  });
}

// Default chain (Ethereum-compatible fallback)
// This will be replaced at runtime when config is loaded
let currentChain: Chain | null = null;

export function getChain(): Chain {
  if (!currentChain) {
    const config = getMinimalConfig();
    currentChain = createChain({
      chainId: config.chainId,
      name: config.chainName || 'EVM Network',
      rpcUrl: config.rpcUrl,
      explorer: config.explorer,
      currency: config.currency || { name: 'Ether', symbol: 'ETH', decimals: 18 },
    });
  }
  return currentChain;
}

// Reset chain when config changes
export function resetChain(): void {
  currentChain = null;
}

// Dynamic chain export (lazily initialized from config)
export const dynamicChain = new Proxy({} as Chain, {
  get: (_, prop) => getChain()[prop as keyof Chain],
});

// Legacy alias for backward compatibility
export const virBiCoin = dynamicChain;

// Static addresses - only Router and MasterChef need to be configured
// Factory and wrapped native token are fetched dynamically from Router contract
export function getDexContracts() {
  const config = getMinimalConfig();
  return {
    router: config.routerV2,
    masterChef: config.masterChefV2,
    factory: config.factoryV2,
    wrappedNative: config.wrappedNative?.address || '0x0000000000000000000000000000000000000000' as `0x${string}`,
  } as const;
}

// Legacy export for backward compatibility
export const DEX_CONTRACTS = new Proxy({} as ReturnType<typeof getDexContracts>, {
  get: (_, prop) => getDexContracts()[prop as keyof ReturnType<typeof getDexContracts>],
});

// Token List
export interface Token {
  address: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
}

// Native token - dynamically generated from config
export function getNativeToken(): Token {
  const config = getMinimalConfig();
  const currency = config.currency || { name: 'Ether', symbol: 'ETH', decimals: 18 };
  // Ensure decimals is a number
  const decimals = typeof currency.decimals === 'bigint' 
    ? Number(currency.decimals) 
    : Number(currency.decimals) || 18;
  return {
    address: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    name: currency.name,
    symbol: currency.symbol,
    decimals: decimals,
  };
}

// Wrapped native token - dynamically generated from config
export function getWrappedNativeToken(): Token {
  const config = getMinimalConfig();
  const wrappedNative = config.wrappedNative;
  if (wrappedNative) {
    // Ensure decimals is a number
    const decimals = typeof wrappedNative.decimals === 'bigint' 
      ? Number(wrappedNative.decimals) 
      : Number(wrappedNative.decimals) || 18;
    return {
      address: wrappedNative.address,
      name: wrappedNative.name,
      symbol: wrappedNative.symbol,
      decimals: decimals,
    };
  }
  // Fallback for WETH-compatible
  const currency = config.currency || { name: 'Ether', symbol: 'ETH', decimals: 18 };
  const decimals = typeof currency.decimals === 'bigint' 
    ? Number(currency.decimals) 
    : Number(currency.decimals) || 18;
  return {
    address: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    name: `Wrapped ${currency.name}`,
    symbol: `W${currency.symbol}`,
    decimals: decimals,
  };
}

// Generic token exports (dynamically loaded from config)
export const NATIVE_TOKEN = new Proxy({} as Token, {
  get: (_, prop) => getNativeToken()[prop as keyof Token],
});

export const WRAPPED_NATIVE_TOKEN = new Proxy({} as Token, {
  get: (_, prop) => getWrappedNativeToken()[prop as keyof Token],
});

// Default tokens - native token is always available, others loaded dynamically
export function getDefaultTokens(): Token[] {
  return [getNativeToken()];
}

export const DEFAULT_TOKENS = new Proxy([] as Token[], {
  get: (_, prop) => {
    if (prop === 'length') return getDefaultTokens().length;
    if (typeof prop === 'string' && !isNaN(Number(prop))) {
      return getDefaultTokens()[Number(prop)];
    }
    return getDefaultTokens()[prop as keyof Token[]];
  },
});

// Default Slippage Settings (in basis points, 100 = 1%)
export const SLIPPAGE_OPTIONS = [50, 100, 300] as const; // 0.5%, 1%, 3%
export const DEFAULT_SLIPPAGE = 100; // 1%

// ABIs - UniswapV2互換ルータ向け
// Note: チェーン/フォークによって関数名・引数（deadline有無）が異なることがある
// 例: WETH() ではなく WVBC()、swapExactETHForTokens ではなく swapExactVBCForTokens など
export const ROUTER_ABI = [
  {
    inputs: [],
    name: 'factory',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'WETH',  // Standard Uniswap V2 method name
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'WVBC',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  // ---- Liquidity (deadline無し版が存在するRouterがある) ----
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
  {
    inputs: [
      { type: 'address', name: 'tokenA' },
      { type: 'address', name: 'tokenB' },
      { type: 'uint256', name: 'amountADesired' },
      { type: 'uint256', name: 'amountBDesired' },
      { type: 'uint256', name: 'amountAMin' },
      { type: 'uint256', name: 'amountBMin' },
      { type: 'address', name: 'to' },
      { type: 'uint256', name: 'deadline' },
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
  {
    inputs: [
      { type: 'address', name: 'token' },
      { type: 'uint256', name: 'amountTokenDesired' },
      { type: 'uint256', name: 'amountTokenMin' },
      { type: 'uint256', name: 'amountETHMin' },
      { type: 'address', name: 'to' },
      { type: 'uint256', name: 'deadline' },
    ],
    name: 'addLiquidityETH',  // Standard Uniswap V2 method name
    outputs: [
      { type: 'uint256', name: 'amountToken' },
      { type: 'uint256', name: 'amountETH' },
      { type: 'uint256', name: 'liquidity' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { type: 'address', name: 'token' },
      { type: 'uint256', name: 'amountTokenDesired' },
      { type: 'uint256', name: 'amountTokenMin' },
      { type: 'uint256', name: 'amountVBCMin' },
      { type: 'address', name: 'to' },
    ],
    name: 'addLiquidityVBC',
    outputs: [
      { type: 'uint256', name: 'amountToken' },
      { type: 'uint256', name: 'amountVBC' },
      { type: 'uint256', name: 'liquidity' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { type: 'address', name: 'tokenA' },
      { type: 'address', name: 'tokenB' },
      { type: 'uint256', name: 'liquidity' },
      { type: 'uint256', name: 'amountAMin' },
      { type: 'uint256', name: 'amountBMin' },
      { type: 'address', name: 'to' },
    ],
    name: 'removeLiquidity',
    outputs: [
      { type: 'uint256', name: 'amountA' },
      { type: 'uint256', name: 'amountB' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { type: 'address', name: 'tokenA' },
      { type: 'address', name: 'tokenB' },
      { type: 'uint256', name: 'liquidity' },
      { type: 'uint256', name: 'amountAMin' },
      { type: 'uint256', name: 'amountBMin' },
      { type: 'address', name: 'to' },
      { type: 'uint256', name: 'deadline' },
    ],
    name: 'removeLiquidity',
    outputs: [
      { type: 'uint256', name: 'amountA' },
      { type: 'uint256', name: 'amountB' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { type: 'address', name: 'token' },
      { type: 'uint256', name: 'liquidity' },
      { type: 'uint256', name: 'amountTokenMin' },
      { type: 'uint256', name: 'amountETHMin' },
      { type: 'address', name: 'to' },
      { type: 'uint256', name: 'deadline' },
    ],
    name: 'removeLiquidityETH',  // Standard Uniswap V2 method name
    outputs: [
      { type: 'uint256', name: 'amountToken' },
      { type: 'uint256', name: 'amountETH' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { type: 'address', name: 'token' },
      { type: 'uint256', name: 'liquidity' },
      { type: 'uint256', name: 'amountTokenMin' },
      { type: 'uint256', name: 'amountVBCMin' },
      { type: 'address', name: 'to' },
    ],
    name: 'removeLiquidityVBC',
    outputs: [
      { type: 'uint256', name: 'amountToken' },
      { type: 'uint256', name: 'amountVBC' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // ---- Swaps (deadline無し版が存在するRouterがある) ----
  {
    inputs: [
      { type: 'uint256', name: 'amountIn' },
      { type: 'uint256', name: 'amountOutMin' },
      { type: 'address[]', name: 'path' },
      { type: 'address', name: 'to' },
    ],
    name: 'swapExactTokensForTokens',
    outputs: [{ type: 'uint256[]', name: 'amounts' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { type: 'uint256', name: 'amountIn' },
      { type: 'uint256', name: 'amountOutMin' },
      { type: 'address[]', name: 'path' },
      { type: 'address', name: 'to' },
      { type: 'uint256', name: 'deadline' },
    ],
    name: 'swapExactTokensForTokens',
    outputs: [{ type: 'uint256[]', name: 'amounts' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { type: 'uint256', name: 'amountOutMin' },
      { type: 'address[]', name: 'path' },
      { type: 'address', name: 'to' },
    ],
    name: 'swapExactVBCForTokens',
    outputs: [{ type: 'uint256[]', name: 'amounts' }],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { type: 'uint256', name: 'amountOutMin' },
      { type: 'address[]', name: 'path' },
      { type: 'address', name: 'to' },
      { type: 'uint256', name: 'deadline' },
    ],
    name: 'swapExactETHForTokens',  // Standard Uniswap V2 method name
    outputs: [{ type: 'uint256[]', name: 'amounts' }],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { type: 'uint256', name: 'amountIn' },
      { type: 'uint256', name: 'amountOutMin' },
      { type: 'address[]', name: 'path' },
      { type: 'address', name: 'to' },
    ],
    name: 'swapExactTokensForVBC',
    outputs: [{ type: 'uint256[]', name: 'amounts' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { type: 'uint256', name: 'amountIn' },
      { type: 'uint256', name: 'amountOutMin' },
      { type: 'address[]', name: 'path' },
      { type: 'address', name: 'to' },
      { type: 'uint256', name: 'deadline' },
    ],
    name: 'swapExactTokensForETH',  // Standard Uniswap V2 method name
    outputs: [{ type: 'uint256[]', name: 'amounts' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { type: 'uint256', name: 'amountIn' },
      { type: 'address[]', name: 'path' },
    ],
    name: 'getAmountsOut',
    outputs: [{ type: 'uint256[]', name: 'amounts' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { type: 'address', name: 'tokenA' },
      { type: 'address', name: 'tokenB' },
    ],
    name: 'getReserves',
    outputs: [
      { type: 'uint256', name: 'reserveA' },
      { type: 'uint256', name: 'reserveB' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { type: 'uint256', name: 'amountA' },
      { type: 'uint256', name: 'reserveA' },
      { type: 'uint256', name: 'reserveB' },
    ],
    name: 'quote',
    outputs: [{ type: 'uint256', name: 'amountB' }],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [
      { type: 'uint256', name: 'amountIn' },
      { type: 'uint256', name: 'reserveIn' },
      { type: 'uint256', name: 'reserveOut' },
    ],
    name: 'getAmountOut',
    outputs: [{ type: 'uint256', name: 'amountOut' }],
    stateMutability: 'pure',
    type: 'function',
  },
] as const;

export const FACTORY_ABI = [
  {
    inputs: [
      { type: 'address', name: 'tokenA' },
      { type: 'address', name: 'tokenB' },
    ],
    name: 'createPair',
    outputs: [{ type: 'address', name: 'pair' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { type: 'address', name: '' },
      { type: 'address', name: '' },
    ],
    name: 'getPair',
    outputs: [{ type: 'address', name: '' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'allPairsLength',
    outputs: [{ type: 'uint256', name: '' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ type: 'uint256', name: '' }],
    name: 'allPairs',
    outputs: [{ type: 'address', name: '' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const PAIR_ABI = [
  {
    inputs: [],
    name: 'token0',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getReserves',
    outputs: [
      { type: 'uint256', name: '_reserve0' },
      { type: 'uint256', name: '_reserve1' },
    ],
    stateMutability: 'view',
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
    inputs: [{ type: 'address', name: '' }],
    name: 'balanceOf',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { type: 'address', name: 'to' },
      { type: 'uint256', name: 'amount' },
    ],
    name: 'transfer',
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { type: 'address', name: 'spender' },
      { type: 'uint256', name: 'amount' },
    ],
    name: 'approve',
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { type: 'address', name: 'owner' },
      { type: 'address', name: 'spender' },
    ],
    name: 'allowance',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ type: 'address', name: 'to' }],
    name: 'burn',
    outputs: [
      { type: 'uint256', name: 'amount0' },
      { type: 'uint256', name: 'amount1' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export const ERC20_ABI = [
  {
    inputs: [],
    name: 'name',
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
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
    inputs: [{ type: 'address', name: 'account' }],
    name: 'balanceOf',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { type: 'address', name: 'spender' },
      { type: 'uint256', name: 'amount' },
    ],
    name: 'approve',
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { type: 'address', name: 'owner' },
      { type: 'address', name: 'spender' },
    ],
    name: 'allowance',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Wrapped native token ABI (WETH-compatible)
export const WRAPPED_NATIVE_ABI = [
  ...ERC20_ABI,
  {
    inputs: [],
    name: 'deposit',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ type: 'uint256', name: 'amount' }],
    name: 'withdraw',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// Legacy export for backward compatibility
export const WVBC_ABI = WRAPPED_NATIVE_ABI;
