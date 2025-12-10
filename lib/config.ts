import fs from 'fs';
import path from 'path';

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
  priceApi?: {
    coingecko?: {
      enabled: boolean;
      id: string;
    };
    coinpaprika?: {
      enabled: boolean;
      id: string;
    };
  };
}

export interface ExplorerConfig {
  name: string;
  description: string;
}

export interface GeneralConfig {
  quiet: boolean;
}

export interface AppConfig {
  nodeAddr: string;
  port: number;
  wsPort: number;
  bulkSize: number;
  syncAll: boolean;
  quiet: boolean;
  useRichList: boolean;
  startBlock: number;
  endBlock: number | null;
  maxRetries: number;
  retryDelay: number;
  logLevel: string;
  web3Provider: Web3ProviderConfig;
  database: DatabaseConfig;
  currency: CurrencyConfig;
  miners: Record<string, string>;
  explorer?: ExplorerConfig;
  general?: GeneralConfig;
  priceUpdateInterval?: number;
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
      configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log('📄 Loaded configuration from config.json');
    } else if (fs.existsSync(exampleConfigPath)) {
      configData = JSON.parse(fs.readFileSync(exampleConfigPath, 'utf8'));
      console.log('📄 Loaded configuration from config.example.json');
    } else {
      console.log('📄 No config files found, using defaults');
    }
    
    // Default configuration
    const defaultConfig: AppConfig = {
      nodeAddr: 'localhost',
      port: 8329,
      wsPort: 8330,
      bulkSize: 100,
      syncAll: true,
      quiet: false,
      useRichList: true,
      startBlock: 0,
      endBlock: null,
      maxRetries: 3,
      retryDelay: 1000,
      logLevel: 'info',
      web3Provider: {
        url: 'http://localhost:8329'
      },
      database: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/explorerDB',
        options: {
          maxPoolSize: 500,
          serverSelectionTimeoutMS: 15000,
          socketTimeoutMS: 60000,
          connectTimeoutMS: 15000,
          bufferCommands: false,
          autoIndex: false,
          autoCreate: false
        }
      },
      currency: {
        name: 'VirBiCoin',
        symbol: 'VBC',
        unit: 'niku',
        decimals: 18,
        gasUnit: 'Gniku'
      },
      miners: {}
    };
    
    // Merge config data with defaults
    cachedConfig = { ...defaultConfig, ...configData } as AppConfig;
    
    // Type assertion for nested objects
    const typedConfigData = configData as Partial<AppConfig>;
    
    // Ensure nested objects are properly merged
    if (typedConfigData.web3Provider && cachedConfig) {
      cachedConfig.web3Provider = { ...defaultConfig.web3Provider, ...typedConfigData.web3Provider };
    }
    
    if (typedConfigData.database && cachedConfig) {
      cachedConfig.database = { ...defaultConfig.database, ...typedConfigData.database };
      if (typedConfigData.database.options) {
        cachedConfig.database.options = { ...defaultConfig.database.options, ...typedConfigData.database.options };
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
    
    // Return minimal config on error
    cachedConfig = {
      nodeAddr: 'localhost',
      port: 8329,
      wsPort: 8330,
      bulkSize: 100,
      syncAll: true,
      quiet: false,
      useRichList: true,
      startBlock: 0,
      endBlock: null,
      maxRetries: 3,
      retryDelay: 1000,
      logLevel: 'info',
      web3Provider: {
        url: process.env.WEB3_PROVIDER_URL || 'http://localhost:8329'
      },
      database: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/explorerDB',
        options: {}
      },
      currency: {
        name: 'VirBiCoin',
        symbol: 'VBC',
        unit: 'niku',
        decimals: 18,
        gasUnit: 'Gniku'
      },
      miners: {}
    };
    
    // Ensure we return the fallback config we just created
    return cachedConfig;
  }
};

/**
 * Get MongoDB URI from config
 */
export const getMongoDBURI = (): string => {
  const config = readConfig();
  return config.database.uri;
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

/**
 * Get currency symbol from config
 */
export const getCurrencySymbol = (): string => {
  const config = readConfig();
  return config.currency?.symbol || 'VBC';
};

/**
 * Get currency name from config
 */
export const getCurrencyName = (): string => {
  const config = readConfig();
  return config.currency?.name || 'VirBiCoin';
};

/**
 * Get currency config from config
 */
export const getCurrencyConfig = () => {
  const config = readConfig();
  return config.currency || {
    name: 'VirBiCoin',
    symbol: 'VBC',
    unit: 'niku',
    decimals: 18,
    gasUnit: 'Gniku'
  };
};

/**
 * Get gas unit for server-side use
 */
export const getGasUnitServer = (): string => {
  const config = readConfig();
  return config.currency?.gasUnit || 'Gniku';
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
};