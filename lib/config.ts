import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveFeatures, type Features } from './features';
import { MissingMongoUriError } from './db/uri';
import {
  parseRewardSchedule,
  type RewardSchedule,
  type RewardScheduleConfig,
} from './reward-schedule';

/**
 * Resolve environment variables in config values
 * Supports ${VAR_NAME} syntax
 */
function resolveEnvVariables(obj: unknown): unknown {
  if (typeof obj === 'string') {
    // Replace ${VAR_NAME} with environment variable value
    return obj.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      const envValue = process.env[varName];
      if (envValue === undefined) {
        console.warn(`⚠️ Environment variable ${varName} is not set`);
        return '';
      }
      return envValue;
    });
  }

  if (Array.isArray(obj)) {
    return obj.map(resolveEnvVariables);
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVariables(value);
    }
    return result;
  }

  return obj;
}

export interface DatabaseConfig {
  uri: string;
  options?: Record<string, unknown>;
}

export interface Web3ProviderConfig {
  url: string;
}

export interface CurrencyConfig {
  name: string;
  symbol: string;
  unit: string;
  decimals: number;
  gasUnit: string;
  icon?: string;
  color?: string;
  priceApi?: {
    coingecko?: {
      enabled: boolean;
      id: string;
    };
    cmc?: {
      enabled: boolean;
      id: string;
    };
    coinpaprika?: {
      enabled: boolean;
      id: string;
    };
    /**
     * On-chain price from the wrapped native / stablecoin pool. Without
     * `pairAddress` the pool is looked up among `dex.lpTokens` and
     * `dex.farmPools`; without `stablecoinAddress` it is `dex.tokens.usdt`.
     */
    dex?: {
      enabled?: boolean;
      pairAddress?: string;
      stablecoinAddress?: string;
    };
  };
}

export interface ExplorerConfig {
  name: string;
  description: string;
  url?: string;
  copyright?: string;
  github?: string;
  /**
   * Decommissioned explorer domains (full URLs) whose on-chain token
   * logoUrl() values should be rewritten to the current `url` host.
   * Optional and empty by default; used after a domain migration where the
   * old host no longer serves images but shares the same image paths.
   */
  legacyUrls?: string[];
}

/** @deprecated use the top-level `quiet`; `general.quiet` is still honoured by price / richlist. */
export interface GeneralConfig {
  quiet: boolean;
}

// Network configuration
export interface NetworkConfig {
  chainId: number;
  name: string;
  slug?: string;
  rpcUrl: string;
  wsUrl?: string;
  explorer?: string;
  blockTime?: number;
}

// Wrapped native token configuration
export interface WrappedNativeConfig {
  address: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
  icon?: string;
  color?: string;
}

// Reward token configuration
export interface RewardTokenConfig {
  symbol: string;
  name: string;
  icon?: string;
  color?: string;
}

// Token configuration for DEX
export interface TokenConfig {
  address: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
  icon?: string;
  color?: string;
}

// LP Token configuration
export interface LPTokenConfig {
  address: `0x${string}`;
  name: string;
  symbol: string;
  token0: string;
  token1: string;
}

// Farm pool configuration
export interface FarmPoolConfig {
  pid: number;
  name: string;
  lpToken: `0x${string}`;
  token0Symbol: string;
  token1Symbol: string;
}

// DEX configuration
export interface DexConfig {
  enabled: boolean;
  name?: string;
  url?: string;
  networkSlug?: string;
  router?: `0x${string}`;
  factory?: `0x${string}`;
  masterChef?: `0x${string}`;
  wrappedNative?: WrappedNativeConfig;
  usdt?: { address?: `0x${string}`; symbol?: string; decimals?: number };
  rewardToken?: RewardTokenConfig & { address?: `0x${string}`; decimals?: number };
  tokens?: Record<string, TokenConfig>;
  lpTokens?: Record<string, LPTokenConfig>;
  farmPools?: FarmPoolConfig[];
}

// Social links configuration
export interface SocialConfig {
  x?: string;
  bitcointalk?: string;
  discord?: string;
  telegram?: string;
  github?: string;
  reddit?: string;
  medium?: string;
}

// Launchpad configuration
export interface LaunchpadAlternativePayment {
  enabled: boolean;
  token?: {
    address: string;
    symbol: string;
    decimals: number;
  };
  fee?: string;
  discountLabel?: string;
  burnNote?: string;
  contractFunctions?: {
    getFeeInfo?: string;
    createToken?: string;
    createTokenWithMetadata?: string;
  };
}

export interface LaunchpadLegacyFactory {
  address: `0x${string}`;
  version?: string;
  note?: string;
}

export interface LaunchpadConfig {
  enabled: boolean;
  factoryAddress: `0x${string}`;
  factoryAddressV2?: `0x${string}`;
  legacyFactories?: LaunchpadLegacyFactory[];
  useV2?: boolean;
  creationFee: string;
  alternativePayment?: LaunchpadAlternativePayment;
}

// Supply configuration
export interface SupplyConfig {
  blockReward?: number;
  premineAmount?: number;
  excludedAddresses?: string[];
  cacheDuration?: number;
}

export interface SyncConfig {
  /** Heights below the head re-verified against the node on every poll (default 12). */
  confirmations?: number;
  /** How far back a common ancestor is searched during a reorg (default 64). */
  maxReorgDepth?: number;
}

/** Call traces for internal transactions (tools/internal-txs.ts). */
export interface TracesConfig {
  /**
   * IPC socket path or http(s) / ws(s) URL of a node that answers the Parity-style
   * `trace_transaction` (OpenEthereum / Ovbc with `--tracing on`). Empty: not indexed.
   * The environment variable TRACE_RPC_URL takes precedence.
   */
  url?: string;
  /** Transactions traced at the same time (default 4). */
  concurrency?: number;
}

export interface ImagesConfig {
  /** Gateway used to rewrite `ipfs://` URIs before fetching (default https://ipfs.io/ipfs/). */
  ipfsGateway?: string;
  /** Extra hostnames next/image may optimize; the explorer host and the gateway are always allowed. */
  allowedHosts?: string[];
}

// Solidity compiler (contract verification) — see lib/contract/compiler-cache.ts / compile-worker.ts
export interface CompilerConfig {
  /** Directory of verified compiler builds (`<version>.js` + `<version>.sha256`). `~` expands to $HOME. */
  cacheDir?: string;
  /** Compile workers running at the same time (default 1). */
  concurrency?: number;
  /** Requests allowed to wait for a worker before the API answers 503 (default 5). */
  maxQueue?: number;
  /** Per-compile timeout in milliseconds; the worker is terminated when exceeded (default 60000). */
  timeoutMs?: number;
  /** V8 old-generation heap limit of a compile worker in MB (default 1024). */
  maxOldGenerationSizeMb?: number;
  /** Optional allow-list of short versions ("0.8.30"); empty = every release build. Nightlies are always refused. */
  allowedVersions?: string[];
  /**
   * EVM version for verifications that do not name one (e.g. "paris" on a chain whose contracts
   * are built for an older rule set). Unset: the compiler's own default.
   */
  defaultEvmVersion?: string;
}

export interface ResolvedCompilerConfig {
  cacheDir: string;
  concurrency: number;
  maxQueue: number;
  timeoutMs: number;
  maxOldGenerationSizeMb: number;
  allowedVersions: string[] | null;
  defaultEvmVersion: string | null;
}

export interface DexInfoConfig {
  name?: string;
  description?: string;
  logo?: string;
  url?: string;
  docsUrl?: string;
  /** DefiLlama protocol slug whose TVL /api/dex/external-price reports (api.llama.fi/tvl/<slug>) */
  defillamaSlug?: string;
  stablePoolAddress?: string;
  [key: string]: unknown;
}

export interface AppConfig {
  nodeAddr: string;
  port: number;
  wsPort: number;
  bulkSize: number;
  syncAll: boolean;
  quiet: boolean;
  startBlock: number;
  endBlock: number | null;
  web3Provider: Web3ProviderConfig;
  database: DatabaseConfig;
  currency: CurrencyConfig;
  miners: Record<string, string>;
  explorer?: ExplorerConfig;
  general?: GeneralConfig;
  priceUpdateInterval?: number;
  network?: NetworkConfig;
  dex?: DexConfig;
  launchpad?: LaunchpadConfig;
  /** Richlist page, API and tool; on unless `enabled` is false (lib/features.ts) */
  richlist?: { enabled?: boolean };
  supply?: SupplyConfig;
  /** Block reward schedule (lib/reward-schedule.ts); Ethereum's when missing */
  rewards?: RewardScheduleConfig;
  social?: SocialConfig;
  /** Public DEX description (GeckoTerminal / DefiLlama endpoints) */
  dexInfo?: DexInfoConfig;
  images?: ImagesConfig;
  sync?: SyncConfig;
  compiler?: CompilerConfig;
  traces?: TracesConfig;
  [key: string]: unknown;
}

let cachedConfig: AppConfig | null = null;

/**
 * Read configuration from config.json with fallback to defaults
 */
export const readConfig = (): AppConfig => {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const configPath = path.join(process.cwd(), 'config.json');
    const exampleConfigPath = path.join(process.cwd(), 'config.example.json');

    let configData: Record<string, unknown> = {};

    if (fs.existsSync(configPath)) {
      const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      configData = resolveEnvVariables(rawConfig) as Record<string, unknown>;
      console.log('📄 Loaded configuration from config.json');
    } else if (fs.existsSync(exampleConfigPath)) {
      const rawConfig = JSON.parse(fs.readFileSync(exampleConfigPath, 'utf8'));
      configData = resolveEnvVariables(rawConfig) as Record<string, unknown>;
      console.log('📄 Loaded configuration from config.example.json');
    } else {
      console.log('📄 No config files found, using defaults');
    }

    // Default configuration (Ethereum fallback)
    const defaultConfig: AppConfig = {
      nodeAddr: 'localhost',
      port: 8545,
      wsPort: 8546,
      bulkSize: 100,
      syncAll: true,
      quiet: false,
      startBlock: 0,
      endBlock: null,
      web3Provider: {
        url: 'http://localhost:8545',
      },
      database: {
        uri: process.env.MONGODB_URI || '',
        options: {
          maxPoolSize: 500,
          serverSelectionTimeoutMS: 15000,
          socketTimeoutMS: 60000,
          connectTimeoutMS: 15000,
          bufferCommands: false,
          autoIndex: false,
          autoCreate: false,
        },
      },
      // Ethereum-compatible defaults
      currency: {
        name: 'Ethereum',
        symbol: 'ETH',
        unit: 'wei',
        decimals: 18,
        gasUnit: 'Gwei',
      },
      network: {
        chainId: 1,
        name: 'Ethereum Mainnet',
        rpcUrl: 'http://localhost:8545',
        blockTime: 12,
      },
      dex: {
        enabled: false,
      },
      miners: {},
    };

    // Merge config data with defaults
    cachedConfig = { ...defaultConfig, ...configData } as AppConfig;

    // Type assertion for nested objects
    const typedConfigData = configData as Partial<AppConfig>;

    // Ensure nested objects are properly merged
    if (typedConfigData.web3Provider && cachedConfig) {
      cachedConfig.web3Provider = {
        ...defaultConfig.web3Provider,
        ...typedConfigData.web3Provider,
      };
    }

    if (typedConfigData.database && cachedConfig) {
      cachedConfig.database = { ...defaultConfig.database, ...typedConfigData.database };
      if (typedConfigData.database.options) {
        cachedConfig.database.options = {
          ...defaultConfig.database.options,
          ...typedConfigData.database.options,
        };
      }
    }

    if (typedConfigData.currency && cachedConfig) {
      cachedConfig.currency = { ...defaultConfig.currency, ...typedConfigData.currency };
    }

    if (typedConfigData.miners && cachedConfig) {
      cachedConfig.miners = { ...defaultConfig.miners, ...typedConfigData.miners };
    }

    // Ensure cachedConfig is not null before returning
    if (!cachedConfig) {
      cachedConfig = defaultConfig;
    }

    return cachedConfig;
  } catch (error) {
    console.error('Error reading config:', error);
    console.log('📄 Using minimal default configuration');

    // Return minimal config on error (Ethereum-compatible defaults)
    cachedConfig = {
      nodeAddr: 'localhost',
      port: 8545,
      wsPort: 8546,
      bulkSize: 100,
      syncAll: true,
      quiet: false,
      startBlock: 0,
      endBlock: null,
      web3Provider: {
        url: process.env.WEB3_PROVIDER_URL || 'http://localhost:8545',
      },
      database: {
        uri: process.env.MONGODB_URI || '',
        options: {},
      },
      currency: {
        name: 'Ethereum',
        symbol: 'ETH',
        unit: 'wei',
        decimals: 18,
        gasUnit: 'Gwei',
      },
      network: {
        chainId: 1,
        name: 'Ethereum Mainnet',
        rpcUrl: 'http://localhost:8545',
        blockTime: 12,
      },
      dex: {
        enabled: false,
      },
      miners: {},
    };

    // Ensure we return the fallback config we just created
    return cachedConfig;
  }
};

/**
 * Get MongoDB URI from config (environment > config.json). Throws
 * MissingMongoUriError when neither provides one: there is no default URI.
 */
export const getMongoDBURI = (): string => {
  const config = readConfig();
  const uri = (config.database?.uri ?? '').trim();
  if (!uri) throw new MissingMongoUriError();
  return uri;
};

/**
 * Get MongoDB options from config
 */
export const getMongoDBOptions = (): Record<string, unknown> => {
  const config = readConfig();
  return config.database.options || {};
};

/**
 * Get Web3 provider URL from config
 */
export const getWeb3ProviderURL = (): string => {
  const config = readConfig();
  return config.web3Provider.url || `http://${config.nodeAddr}:${config.port}`;
};

/** Where tools/internal-txs.ts reads call traces from; null when it is not configured. */
export const getTraceSourceUrl = (
  env: Record<string, string | undefined> = process.env
): string | null => {
  const fromEnv = env.TRACE_RPC_URL?.trim();
  if (fromEnv) return fromEnv;
  const url = readConfig().traces?.url;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
};

/**
 * Get currency symbol from config
 */
export const getCurrencySymbol = (): string => {
  const config = readConfig();
  return config.currency?.symbol || 'ETH';
};

/**
 * Get currency name from config
 */
/** Network name from config.json (Ethereum's by default). */
export const getNetworkName = (): string => readConfig().network?.name || 'Ethereum';

/** Chain id from config.json (1 by default). */
export const getChainId = (): number => readConfig().network?.chainId || 1;

/** URL-friendly network id: `network.slug`, else the network name in lower case with dashes. */
export const getNetworkSlug = (): string => {
  const network = readConfig().network;
  const fromName = (network?.name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return network?.slug || fromName || 'ethereum';
};

/** Symbol of the wrapped native token: `dex.wrappedNative.symbol`, else "W" + the currency symbol. */
export const getWrappedNativeSymbol = (): string =>
  readConfig().dex?.wrappedNative?.symbol || `W${getCurrencySymbol()}`;

export const getCurrencyName = (): string => {
  const config = readConfig();
  return config.currency?.name || 'Ethereum';
};

/**
 * Get currency config from config
 */
export const getCurrencyConfig = () => {
  const config = readConfig();
  return (
    config.currency || {
      name: 'Ethereum',
      symbol: 'ETH',
      unit: 'wei',
      decimals: 18,
      gasUnit: 'Gwei',
    }
  );
};

/**
 * Get gas unit for server-side use
 */
export const getGasUnitServer = (): string => {
  const config = readConfig();
  return config.currency?.gasUnit || 'Gwei';
};

/**
 * Get miners config
 */
export const getMinersConfig = (): Record<string, string> => {
  const config = readConfig();
  return config.miners || {};
};

/**
 * Load config (alias for readConfig for compatibility)
 */
export const loadConfig = readConfig;

/**
 * Clear cached config (useful for testing)
 */
export const clearConfigCache = (): void => {
  cachedConfig = null;
  cachedRewardSchedule = null;
};

let cachedRewardSchedule: RewardSchedule | null = null;

/**
 * The chain's block reward schedule from config.json `rewards`. Without that section the
 * schedule is Ethereum's, which is wrong for other chains, so say so once.
 */
/** The optional parts switched on in config.json (lib/features.ts). */
export const getFeatures = (): Features => resolveFeatures(readConfig());

export const getRewardSchedule = (): RewardSchedule => {
  if (!cachedRewardSchedule) {
    const rewards = readConfig().rewards;
    if (!rewards?.blockReward) {
      console.warn(
        "config.json has no rewards.blockReward: using Ethereum's block rewards for supply and mining figures"
      );
    }
    cachedRewardSchedule = parseRewardSchedule(rewards);
  }
  return cachedRewardSchedule;
};

// ---------------------------------------------------------------------------
// Compiler (contract verification) settings

export const DEFAULT_COMPILER_CACHE_DIR = '~/.cache/vbc-solc';
export const COMPILER_DEFAULTS = Object.freeze({
  concurrency: 1,
  maxQueue: 5,
  timeoutMs: 60_000,
  maxOldGenerationSizeMb: 1024,
});

/** Expand a leading `~` to the home directory and make the path absolute. */
export function expandHomeDir(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '~' || trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(1));
  }
  return path.resolve(trimmed);
}

function positiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * `config.compiler` with defaults applied. `SOLC_CACHE_DIR` overrides the
 * cache directory (handy for tests and containers).
 */
export const getCompilerConfig = (): ResolvedCompilerConfig => {
  const raw = (readConfig().compiler ?? {}) as CompilerConfig;
  const allowed = Array.isArray(raw.allowedVersions)
    ? raw.allowedVersions.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    : [];
  return {
    cacheDir: expandHomeDir(
      process.env.SOLC_CACHE_DIR || raw.cacheDir || DEFAULT_COMPILER_CACHE_DIR
    ),
    concurrency: positiveInt(raw.concurrency, COMPILER_DEFAULTS.concurrency),
    maxQueue: positiveInt(raw.maxQueue, COMPILER_DEFAULTS.maxQueue),
    timeoutMs: positiveInt(raw.timeoutMs, COMPILER_DEFAULTS.timeoutMs),
    maxOldGenerationSizeMb: positiveInt(
      raw.maxOldGenerationSizeMb,
      COMPILER_DEFAULTS.maxOldGenerationSizeMb
    ),
    allowedVersions: allowed.length > 0 ? allowed : null,
    defaultEvmVersion:
      typeof raw.defaultEvmVersion === 'string' && raw.defaultEvmVersion.trim() !== ''
        ? raw.defaultEvmVersion.trim()
        : null,
  };
};
