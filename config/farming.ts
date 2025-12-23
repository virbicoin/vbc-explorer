// Farming (Yield Mining) Configuration
// Generic MasterChef V2 compatible configuration
// NOTE: Only minimal static configuration is stored here.
// Other values (factory, wrapped native, pools, etc.) are fetched dynamically from blockchain.
// All chain-specific configuration comes from config.json

// Pool data interface (for runtime data)
export interface PoolConfig {
  pid: number;
  name: string;
  lpToken: `0x${string}`;
  token0: {
    symbol: string;
    name: string;
    address: `0x${string}`;
    decimals: number;
  };
  token1: {
    symbol: string;
    name: string;
    address: `0x${string}`;
    decimals: number;
  };
  allocPoint: number;
}

// Static network configuration (cannot be fetched from blockchain)
export interface NetworkConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorer: string;
  blockTime: number;
}

// Minimal static contracts (only what's needed to bootstrap)
export interface MinimalContracts {
  router: `0x${string}`;
  masterChef: `0x${string}`;
}

// Full farming config (populated at runtime from blockchain)
export interface FarmingConfig {
  network: NetworkConfig;
  contracts: {
    masterChef: `0x${string}`;
    wrappedNative: `0x${string}`;  // Generic wrapped native token (WETH, WVBC, WBNB, etc.)
    factoryV2: `0x${string}`;
    routerV2: `0x${string}`;
  };
  rewardToken: {
    address: `0x${string}`;
    name: string;
    symbol: string;
    decimals: number;
  };
  pools: PoolConfig[];
  settings: {
    rewardPerBlock: string;
    rewardPerBlockFormatted: string;
    blocksPerDay: number;
    blocksPerYear: number;
  };
}

// Default network configuration (Ethereum mainnet as fallback)
// These values are overridden by config.json at runtime
export const DEFAULT_NETWORK_CONFIG: NetworkConfig = {
  name: "Ethereum",
  chainId: 1,
  rpcUrl: "http://localhost:8545",
  explorer: "https://etherscan.io",
  blockTime: 12  // Ethereum average block time
};

// Default empty contracts (to be populated from config.json)
export const DEFAULT_STATIC_CONTRACTS: MinimalContracts = {
  router: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  masterChef: "0x0000000000000000000000000000000000000000" as `0x${string}`,
};

// Runtime mutable configuration (will be set from config.json)
let NETWORK_CONFIG: NetworkConfig = { ...DEFAULT_NETWORK_CONFIG };
let STATIC_CONTRACTS: MinimalContracts = { ...DEFAULT_STATIC_CONTRACTS };

// Function to initialize farming config from config.json
export function initFarmingConfig(config: {
  network?: {
    name?: string;
    chainId?: number;
    rpcUrl?: string;
    explorer?: string;
    blockTime?: number;
  };
  dex?: {
    router?: string;
    masterChef?: string;
  };
}): void {
  if (config.network) {
    NETWORK_CONFIG = {
      name: config.network.name ?? DEFAULT_NETWORK_CONFIG.name,
      chainId: config.network.chainId ?? DEFAULT_NETWORK_CONFIG.chainId,
      rpcUrl: config.network.rpcUrl ?? DEFAULT_NETWORK_CONFIG.rpcUrl,
      explorer: config.network.explorer ?? DEFAULT_NETWORK_CONFIG.explorer,
      blockTime: config.network.blockTime ?? DEFAULT_NETWORK_CONFIG.blockTime,
    };
  }
  if (config.dex) {
    STATIC_CONTRACTS = {
      router: (config.dex.router ?? DEFAULT_STATIC_CONTRACTS.router) as `0x${string}`,
      masterChef: (config.dex.masterChef ?? DEFAULT_STATIC_CONTRACTS.masterChef) as `0x${string}`,
    };
  }
}

// Getters for runtime configuration
export function getNetworkConfig(): NetworkConfig {
  return NETWORK_CONFIG;
}

export function getStaticContracts(): MinimalContracts {
  return STATIC_CONTRACTS;
}

// Block timing constants (calculated from block time)
const SECONDS_PER_YEAR = 31_536_000; // 365 days

export function getBlocksPerDay(): number {
  return Math.floor(86400 / NETWORK_CONFIG.blockTime);
}

export function getBlocksPerYear(): number {
  // Use seconds per year directly for more accurate calculation
  return Math.floor(SECONDS_PER_YEAR / NETWORK_CONFIG.blockTime);
}

// Legacy compatibility - FARMING_CONFIG with placeholder values for dynamic fields
// This will be populated at runtime by fetchDexConfig()
export function createFarmingConfig(): FarmingConfig {
  return {
    network: NETWORK_CONFIG,
    contracts: {
      masterChef: STATIC_CONTRACTS.masterChef,
      wrappedNative: "0x0000000000000000000000000000000000000000" as `0x${string}`, // Fetched dynamically
      factoryV2: "0x0000000000000000000000000000000000000000" as `0x${string}`, // Fetched dynamically
      routerV2: STATIC_CONTRACTS.router
    },
    rewardToken: {
      address: "0x0000000000000000000000000000000000000000" as `0x${string}`, // Fetched dynamically
      name: "Unknown",
      symbol: "???",
      decimals: 18
    },
    pools: [], // Fetched dynamically from MasterChef
    settings: {
      rewardPerBlock: "0", // Fetched dynamically
      rewardPerBlockFormatted: "0",
      blocksPerDay: getBlocksPerDay(),
      blocksPerYear: getBlocksPerYear()
    }
  };
}

// Legacy exports for backward compatibility
export { NETWORK_CONFIG, STATIC_CONTRACTS };
export const BLOCKS_PER_DAY = Math.floor(86400 / DEFAULT_NETWORK_CONFIG.blockTime);
export const BLOCKS_PER_YEAR = BLOCKS_PER_DAY * 365;
export const FARMING_CONFIG: FarmingConfig = createFarmingConfig();
export const MASTER_CHEF_ADDRESS = DEFAULT_STATIC_CONTRACTS.masterChef;
export const REWARD_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`; // Use dynamic fetching
