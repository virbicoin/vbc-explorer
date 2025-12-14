// DEX Configuration for VirBiCoin Network

import { defineChain } from 'viem';

// VirBiCoin Chain Definition
export const virBiCoin = defineChain({
  id: 329,
  name: 'VirBiCoin',
  nativeCurrency: {
    name: 'VBC',
    symbol: 'VBC',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.digitalregion.jp'],
    },
    public: {
      http: ['https://rpc.digitalregion.jp'],
    },
  },
  blockExplorers: {
    default: {
      name: 'VBC Explorer',
      url: 'https://explorer.digitalregion.jp',
    },
  },
});

// Contract Addresses
export const DEX_CONTRACTS = {
  factory: '0xE85A5BF52711c1eD2e94C8d6c8ba6717e70FE94F' as `0x${string}`,
  router: '0x9Ad9B2b3E9C6FFd90d05BC322E01ACb2876AbaA9' as `0x${string}`,
  wvbc: '0x52CB9F0d65D9d4De08CF103153C7A1A97567Bb9b' as `0x${string}`,
} as const;

// Token List
export interface Token {
  address: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
}

export const VBC_TOKEN: Token = {
  address: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  name: 'VirBiCoin',
  symbol: 'VBC',
  decimals: 18,
};

export const WVBC_TOKEN: Token = {
  address: DEX_CONTRACTS.wvbc,
  name: 'Wrapped VBC',
  symbol: 'WVBC',
  decimals: 18,
};

export const DEFAULT_TOKENS: Token[] = [
  VBC_TOKEN,
  WVBC_TOKEN,
  {
    address: '0x7Dcd1b201D6F7a77fc39802f33b8662946220377' as `0x${string}`,
    name: 'Test Token',
    symbol: 'TEST',
    decimals: 18,
  },
];

// Default Slippage Settings (in basis points, 100 = 1%)
export const SLIPPAGE_OPTIONS = [50, 100, 300] as const; // 0.5%, 1%, 3%
export const DEFAULT_SLIPPAGE = 100; // 1%

// ABIs
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
    name: 'WVBC',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
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

export const WVBC_ABI = [
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
