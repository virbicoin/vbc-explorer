// DEX Contract Service - Fetches contract info dynamically from blockchain
// Configuration is loaded from config.json via API or directly on server
// This module can be used on both server and client side

import Web3 from 'web3';

// Configuration type definition
export interface MinimalConfig {
  chainId: number;
  chainName?: string;
  rpcUrl: string;
  explorer: string;
  routerV2: `0x${string}`;
  factoryV2: `0x${string}`;
  masterChefV2: `0x${string}`;
  currency?: {
    name: string;
    symbol: string;
    decimals: number;
  };
  wrappedNative?: {
    address: `0x${string}`;
    name: string;
    symbol: string;
    decimals: number;
  };
}

// Default fallback configuration (Ethereum-compatible)
// This will be overridden by config.json settings
const DEFAULT_CONFIG: MinimalConfig = {
  chainId: 1,
  chainName: 'Ethereum',
  rpcUrl: 'http://localhost:8545',
  explorer: 'https://etherscan.io',
  routerV2: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  factoryV2: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  masterChefV2: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  currency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
};

// Configuration loaded from config.json (populated on server side)
let loadedConfig: MinimalConfig | null = null;
let configLoading: Promise<void> | null = null;

// Get minimal config - will be loaded from config.json on server side
export function getMinimalConfig(): MinimalConfig {
  return loadedConfig || DEFAULT_CONFIG;
}

// Check if config is loaded
export function isConfigLoaded(): boolean {
  return loadedConfig !== null;
}

// Initialize config from API (for client-side use)
export async function initializeDexConfig(): Promise<MinimalConfig> {
  if (loadedConfig) {
    return loadedConfig;
  }

  // Prevent multiple simultaneous loads
  if (configLoading) {
    await configLoading;
    return loadedConfig || DEFAULT_CONFIG;
  }

  configLoading = (async () => {
    try {
      // Fetch both config endpoints in parallel
      const [clientConfigRes, dexConfigRes] = await Promise.all([
        fetch('/api/config/client'),
        fetch('/api/dex/config'),
      ]);

      if (!clientConfigRes.ok) {
        throw new Error('Failed to fetch client config');
      }
      const clientConfig = await clientConfigRes.json();

      // DEX config contains factory address from blockchain
      let factoryAddress = DEFAULT_CONFIG.factoryV2;
      let wrappedNativeAddress =
        clientConfig.dex?.wrappedNative?.address || DEFAULT_CONFIG.wrappedNative?.address;

      if (dexConfigRes.ok) {
        const dexConfig = await dexConfigRes.json();
        if (dexConfig.data?.contracts?.factory) {
          factoryAddress = dexConfig.data.contracts.factory as `0x${string}`;
        }
        if (dexConfig.data?.contracts?.wrappedNative) {
          wrappedNativeAddress = dexConfig.data.contracts.wrappedNative as `0x${string}`;
        }
      }

      // Set the config from API response
      setMinimalConfig({
        chainId: clientConfig.network?.chainId || DEFAULT_CONFIG.chainId,
        chainName: clientConfig.network?.name || DEFAULT_CONFIG.chainName,
        rpcUrl: clientConfig.network?.rpcUrl || DEFAULT_CONFIG.rpcUrl,
        explorer: clientConfig.network?.explorer || DEFAULT_CONFIG.explorer,
        routerV2: (clientConfig.dex?.router || DEFAULT_CONFIG.routerV2) as `0x${string}`,
        factoryV2: factoryAddress,
        masterChefV2: (clientConfig.dex?.masterChef ||
          DEFAULT_CONFIG.masterChefV2) as `0x${string}`,
        currency: clientConfig.currency || DEFAULT_CONFIG.currency,
        wrappedNative: clientConfig.dex?.wrappedNative
          ? {
              ...clientConfig.dex.wrappedNative,
              address: wrappedNativeAddress as `0x${string}`,
            }
          : undefined,
      });

      const currentConfig = getMinimalConfig();
      console.log('[initializeDexConfig] Config loaded:', {
        chainId: currentConfig.chainId,
        rpcUrl: currentConfig.rpcUrl,
        router: currentConfig.routerV2,
        factory: currentConfig.factoryV2,
        wrappedNative: currentConfig.wrappedNative?.address,
      });
    } catch (error) {
      console.error('[initializeDexConfig] Failed to load config:', error);
    }
  })();

  await configLoading;
  configLoading = null;
  return loadedConfig || DEFAULT_CONFIG;
}

// Set config from external source (called by server-side code)
export function setMinimalConfig(
  config: Partial<MinimalConfig> & {
    chainId: number;
    rpcUrl: string;
    routerV2: `0x${string}`;
    masterChefV2: `0x${string}`;
  }
) {
  loadedConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    factoryV2: config.factoryV2 || DEFAULT_CONFIG.factoryV2,
    explorer: config.explorer || DEFAULT_CONFIG.explorer,
  };
}

// Legacy export for backwards compatibility
export const MINIMAL_CONFIG = DEFAULT_CONFIG;

// ABIs for reading contract data

const ROUTER_ABI: any = [
  {
    inputs: [],
    name: 'factory',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  // WETH is standard for Uniswap V2, but some chains use WVBC, WBNB, etc.
  {
    inputs: [],
    name: 'WETH',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const FACTORY_ABI: any = [
  {
    inputs: [],
    name: 'allPairsLength',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ type: 'uint256' }],
    name: 'allPairs',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const MASTERCHEF_ABI: any = [
  {
    inputs: [],
    name: 'rewardToken',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'rewardPerBlock',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'poolLength',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalAllocPoint',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  // Use getPoolInfo for MasterChef V2
  {
    inputs: [{ type: 'uint256', name: '_pid' }],
    name: 'getPoolInfo',
    outputs: [
      { name: 'lpToken', type: 'address' },
      { name: 'allocPoint', type: 'uint256' },
      { name: 'lastRewardBlock', type: 'uint256' },
      { name: 'totalStaked', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

const ERC20_ABI: any = [
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
    inputs: [{ type: 'address' }],
    name: 'balanceOf',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const PAIR_ABI: any = [
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
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

// Token interface
export interface TokenInfo {
  address: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
}

// Pool interface
export interface PoolInfo {
  pid: number;
  lpToken: `0x${string}`;
  allocPoint: number;
  token0: TokenInfo;
  token1: TokenInfo;
}

// DEX Config interface
export interface DexConfig {
  chainId: number;
  rpcUrl: string;
  explorer: string;
  router: `0x${string}`;
  factory: `0x${string}`;
  wrappedNative: `0x${string}`; // WETH, WVBC, WBNB, etc.
  masterChef: `0x${string}`;
  rewardToken: TokenInfo;
  rewardPerBlock: string;
  rewardPerBlockFormatted: string;
  pools: PoolInfo[];
  lastUpdated: number;
}

// Cache
let cachedConfig: DexConfig | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 1000; // 1 minute cache

// Get Web3 instance
function getWeb3(): Web3 {
  const config = getMinimalConfig();
  return new Web3(config.rpcUrl);
}

// Fetch token info from blockchain
async function fetchTokenInfo(web3: Web3, address: string): Promise<TokenInfo> {
  const contract = new web3.eth.Contract(ERC20_ABI, address);

  const [name, symbol, decimals] = await Promise.all([
    contract.methods.name().call() as Promise<string>,
    contract.methods.symbol().call() as Promise<string>,
    contract.methods.decimals().call() as Promise<number>,
  ]);

  return {
    address: address as `0x${string}`,
    name: String(name),
    symbol: String(symbol),
    decimals: Number(decimals),
  };
}

// Fetch all DEX configuration from blockchain
export async function fetchDexConfig(forceRefresh = false): Promise<DexConfig> {
  // Return cached config if valid
  if (!forceRefresh && cachedConfig && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedConfig;
  }

  const config = getMinimalConfig();
  const web3 = getWeb3();

  // Get Router contract
  const router = new web3.eth.Contract(ROUTER_ABI, config.routerV2);

  // Fetch Factory address from Router
  const factoryAddress = (await router.methods.factory().call()) as string;

  // Try to get wrapped native token address from router
  // Standard Uniswap V2 uses WETH(), but some forks use custom names like WVBC(), WBNB()
  let wrappedNativeAddress: string;
  try {
    wrappedNativeAddress = (await router.methods.WETH().call()) as string;
  } catch {
    // Fallback: try WVBC for VirBiCoin-based routers
    try {
      const wvbcAbi = [
        {
          inputs: [],
          name: 'WVBC',
          outputs: [{ type: 'address' }],
          stateMutability: 'view',
          type: 'function',
        },
      ];
      const routerWithWVBC = new web3.eth.Contract(wvbcAbi, config.routerV2);
      wrappedNativeAddress = (await routerWithWVBC.methods.WVBC().call()) as string;
    } catch {
      // If all methods fail, use config value or zero address
      wrappedNativeAddress =
        config.wrappedNative?.address || '0x0000000000000000000000000000000000000000';
    }
  }

  // Get MasterChef contract
  const masterChef = new web3.eth.Contract(MASTERCHEF_ABI, config.masterChefV2);

  // Fetch MasterChef info
  const [rewardTokenAddress, rewardPerBlockRaw, poolLength] = await Promise.all([
    masterChef.methods.rewardToken().call() as Promise<string>,
    masterChef.methods.rewardPerBlock().call() as Promise<string>,
    masterChef.methods.poolLength().call() as Promise<string>,
  ]);

  // Fetch reward token info
  const rewardToken = await fetchTokenInfo(web3, rewardTokenAddress);

  // Format reward per block
  const rewardPerBlockBN = BigInt(rewardPerBlockRaw);
  const rewardPerBlockFormatted = (Number(rewardPerBlockBN) / 1e18).toString();

  // Fetch all pools
  const pools: PoolInfo[] = [];
  const numPools = Number(poolLength);

  for (let pid = 0; pid < numPools; pid++) {
    try {
      // Use getPoolInfo for MasterChef V2
      const poolInfoRaw = (await masterChef.methods.getPoolInfo(pid).call()) as {
        lpToken: string;
        allocPoint: string;
        lastRewardBlock: string;
        totalStaked: string;
      };

      const lpTokenAddress = poolInfoRaw.lpToken;
      const allocPoint = Number(poolInfoRaw.allocPoint);

      // Get LP token pair info
      const pair = new web3.eth.Contract(PAIR_ABI, lpTokenAddress);
      const [token0Address, token1Address] = await Promise.all([
        pair.methods.token0().call() as Promise<string>,
        pair.methods.token1().call() as Promise<string>,
      ]);

      // Fetch token info
      const [token0, token1] = await Promise.all([
        fetchTokenInfo(web3, token0Address),
        fetchTokenInfo(web3, token1Address),
      ]);

      pools.push({
        pid,
        lpToken: lpTokenAddress as `0x${string}`,
        allocPoint,
        token0,
        token1,
      });
    } catch (error) {
      console.error(`[fetchDexConfig] Error fetching pool ${pid}:`, error);
    }
  }

  // Build config
  cachedConfig = {
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    explorer: config.explorer,
    router: config.routerV2,
    factory: factoryAddress as `0x${string}`,
    wrappedNative: wrappedNativeAddress as `0x${string}`,
    masterChef: config.masterChefV2,
    rewardToken,
    rewardPerBlock: rewardPerBlockRaw,
    rewardPerBlockFormatted,
    pools,
    lastUpdated: Date.now(),
  };

  cacheTimestamp = Date.now();

  return cachedConfig;
}

// Get cached config (sync) - returns null if not loaded
export function getCachedDexConfig(): DexConfig | null {
  if (cachedConfig && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedConfig;
  }
  return null;
}

// Clear cache
export function clearDexConfigCache(): void {
  cachedConfig = null;
  cacheTimestamp = 0;
}

// Native token placeholder (will be populated from config)
// Default to Ethereum if no config is set
export function getNativeToken(currencyConfig?: {
  name: string;
  symbol: string;
  decimals: number;
  icon?: string;
  color?: string;
}): TokenInfo & { logoURI?: string } {
  return {
    address: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    name: currencyConfig?.name || 'Ether',
    symbol: currencyConfig?.symbol || 'ETH',
    decimals: currencyConfig?.decimals || 18,
    logoURI: currencyConfig?.icon || undefined,
  };
}

// Legacy export for backwards compatibility
export const VBC_NATIVE_TOKEN: TokenInfo = {
  address: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  name: 'Ether',
  symbol: 'ETH',
  decimals: 18,
};
