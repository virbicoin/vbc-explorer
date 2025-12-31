#!/usr/bin/env node
/*
Tool for fetching and updating cryptocurrency price data
*/

import { Market } from '../models/index';
import mongoose from 'mongoose';
import { connectDB } from '../models/index';
import { loadConfig, getCurrencyConfig, AppConfig, CurrencyConfig } from '../lib/config';

// Initialize database connection
const initDB = async () => {
  try {
    // Check if already connected
    if (mongoose.connection.readyState === 1) {
      return;
    }

    await connectDB();

    // Wait for connection to be fully established
    let retries = 0;
    const maxRetries = 30;
    while ((mongoose.connection.readyState as number) !== 1 && retries < maxRetries) {
      console.log('⌛ Waiting for database connection...');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      retries++;
    }

    if ((mongoose.connection.readyState as number) !== 1) {
      throw new Error('Database connection timeout');
    }

    console.log('🔗 Database connection initialized successfully');
  } catch (error) {
    console.error('❌ Failed to connect to database:', error);
    process.exit(1);
  }
};

// Memory monitoring function
const checkMemory = () => {
  const usage = process.memoryUsage();
  const usedMB = Math.round(usage.heapUsed / 1024 / 1024);
  const limitMB = parseInt(process.env.MEMORY_LIMIT_MB || '256'); // Optimized for 2GB instances

  if (usedMB > limitMB) {
    console.log(`⚠️ Memory usage: ${usedMB}MB (limit: ${limitMB}MB)`);
    if (global.gc) {
      global.gc();
      console.log('🧹 Garbage collection executed');
    }
    return false;
  }
  return true;
};

// Interface definitions
interface Config {
  nodeAddr: string;
  port: number;
  quiet: boolean;
  priceUpdateInterval: number;
  currency?: {
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
  };
}

interface PriceData {
  symbol: string;
  timestamp: number;
  quoteBTC: number;
  quoteUSD: number;
}

// Configuration
const config: AppConfig = loadConfig();
const currencyConfig: CurrencyConfig = getCurrencyConfig();

// Initialize database connection after config is loaded
initDB();

if (config.general?.quiet) {
  console.log('🔇 Quiet mode enabled');
}

// Price cache to avoid frequent API calls
const priceCache = new Map<string, { data: PriceData; timestamp: number }>();
const CACHE_DURATION = 60000; // 1 minute cache

/**
 * Fetch current cryptocurrency price from external API with retry mechanism, caching, and parallel requests
 */
const fetchCryptoPrice = async (): Promise<PriceData | null> => {
  try {
    const currency = currencyConfig;
    if (!currency) {
      console.error('❌ Currency configuration not found');
      return null;
    }

    // Check cache first
    const cacheKey = currency.symbol;
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log(`📋 Using cached price data for ${currency.symbol}`);
      return cached.data;
    }

    const priceSources: Array<{
      name: string;
      url: string;

      parser: (data: any) => { quoteBTC: number; quoteUSD: number } | null;
    }> = [];

    // Add CoinGecko API if enabled
    if (currency.priceApi?.coingecko?.enabled) {
      priceSources.push({
        name: 'CoinGecko',
        url: `https://api.coingecko.com/api/v3/simple/price?ids=${currency.priceApi.coingecko.id}&vs_currencies=btc,usd`,

        parser: (data: any) => {
          const coinId = currency.priceApi?.coingecko?.id;
          if (coinId && data[coinId]) {
            return {
              quoteBTC: data[coinId].btc || 0,
              quoteUSD: data[coinId].usd || 0,
            };
          }
          return null;
        },
      });
    }

    // Add CoinPaprika API if enabled
    if (currency.priceApi?.coinpaprika?.enabled) {
      priceSources.push({
        name: 'CoinPaprika',
        url: `https://api.coinpaprika.com/v1/tickers/${currency.priceApi.coinpaprika.id}`,

        parser: (data: any) => ({
          quoteBTC: data.quotes?.BTC?.price || 0,
          quoteUSD: data.quotes?.USD?.price || 0,
        }),
      });
    }

    // If no price APIs are configured, use fallback
    if (priceSources.length === 0) {
      console.log('⚠️ No price APIs configured, using fallback data');
      const fallbackData = {
        symbol: currency.symbol,
        timestamp: Date.now(),
        quoteBTC: 0.000001, // Mock BTC price
        quoteUSD: 0.05, // Mock USD price
      };
      priceCache.set(cacheKey, { data: fallbackData, timestamp: Date.now() });
      return fallbackData;
    }

    // Parallel API calls with timeout and error handling
    const fetchPromises = priceSources.map(async (source) => {
      try {
        console.log(`🔄 Fetching price from ${source.name}...`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout

        const response = await fetch(source.url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'VirBiCoin-Explorer/1.0',
            Accept: 'application/json',
            'Cache-Control': 'no-cache',
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const priceData = source.parser(data);

        if (priceData && (priceData.quoteUSD > 0 || priceData.quoteBTC > 0)) {
          console.log(
            `✅ Successfully fetched from ${source.name}: $${priceData.quoteUSD} USD, ${priceData.quoteBTC} BTC`
          );
          return {
            source: source.name,
            ...priceData,
          };
        }
        return null;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`❌ Failed to fetch from ${source.name}: ${errorMessage}`);
        return null;
      }
    });

    // Wait for all promises and take the first successful result
    const results = await Promise.allSettled(fetchPromises);

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const priceResult = {
          symbol: currency.symbol,
          timestamp: Date.now(),
          quoteBTC: result.value.quoteBTC,
          quoteUSD: result.value.quoteUSD,
        };

        // Cache the result
        priceCache.set(cacheKey, { data: priceResult, timestamp: Date.now() });

        return priceResult;
      }
    }

    // Fallback: use mock data if no external API works
    console.log('🔄 Using fallback price data');
    const fallbackData = {
      symbol: currency.symbol,
      timestamp: Date.now(),
      quoteBTC: 0.000001, // Mock BTC price
      quoteUSD: 0.05, // Mock USD price
    };

    // Cache fallback data for shorter duration
    priceCache.set(cacheKey, { data: fallbackData, timestamp: Date.now() - CACHE_DURATION / 2 });

    return fallbackData;
  } catch (error) {
    console.error(`❌ Error fetching ${currencyConfig?.symbol || 'crypto'} price:`, error);
    return null;
  }
};

/**
 * Update price data in database with memory management
 */
const updatePriceData = async (priceData: PriceData): Promise<void> => {
  try {
    // Memory check before database operation
    if (!checkMemory()) {
      console.log('💾 Memory limit reached, waiting before database update');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const market = new Market(priceData);
    await market.save();

    if (!config.general?.quiet) {
      console.log(
        `💰 Price data updated: ${priceData.symbol} = $${priceData.quoteUSD} (${priceData.quoteBTC} BTC)`
      );
    }
  } catch (error) {
    console.error('❌ Error updating price data:', error);
  }
};

/**
 * Get latest price from database
 */
const getLatestPrice = async (): Promise<PriceData | null> => {
  try {
    const latestPrice = await Market.findOne().sort({ timestamp: -1 });
    return latestPrice;
  } catch (error) {
    console.error('❌ Error getting latest price:', error);
    return null;
  }
};

/**
 * Check if price data needs updating
 */
const shouldUpdatePrice = async (): Promise<boolean> => {
  try {
    const latestPrice = await getLatestPrice();
    if (!latestPrice) return true;

    const timeSinceLastUpdate = Date.now() - latestPrice.timestamp;
    return timeSinceLastUpdate > (config.priceUpdateInterval || 30 * 60 * 1000);
  } catch (error) {
    console.error('❌ Error checking price update status:', error);
    return true;
  }
};

/**
 * Main price update function with error handling and memory management
 */
const updatePrice = async (): Promise<void> => {
  try {
    // Memory check before processing
    if (!checkMemory()) {
      console.log('💾 Memory limit reached, skipping price update');
      return;
    }

    if (!(await shouldUpdatePrice())) {
      if (!config.general?.quiet) {
        console.log('✅ Price data is up to date');
      }
      return;
    }

    const priceData = await fetchCryptoPrice();
    if (priceData) {
      await updatePriceData(priceData);
    } else {
      console.error('❌ Failed to fetch price data');
    }
  } catch (error) {
    console.error('❌ Error in price update:', error);
  }
};

/**
 * Continuous price monitoring with improved error handling
 */
const startPriceMonitoring = async (): Promise<void> => {
  const currencySymbol = currencyConfig?.symbol || 'CRYPTO';
  console.log(`💰 Starting ${currencySymbol} price monitoring...`);
  console.log(
    `⏰ Update interval: ${(config.priceUpdateInterval || 30 * 60 * 1000) / 1000} seconds`
  );

  // Initial update
  await updatePrice();

  // Set up periodic updates with error handling
  setInterval(
    async () => {
      try {
        await updatePrice();
      } catch (error) {
        console.error('❌ Error in periodic price update:', error);
      }
    },
    config.priceUpdateInterval || 30 * 60 * 1000
  );
};

/**
 * One-time price update
 */
const runOnce = async (): Promise<void> => {
  console.log('🔄 Running one-time price update...');
  await updatePrice();
  process.exit(0);
};

/**
 * Show current price
 */
const showCurrentPrice = async (): Promise<void> => {
  const latestPrice = await getLatestPrice();
  if (latestPrice) {
    console.log(
      `💰 Current ${latestPrice.symbol} price: $${latestPrice.quoteUSD} (${latestPrice.quoteBTC} BTC)`
    );
    console.log(`🕐 Last updated: ${new Date(latestPrice.timestamp).toLocaleString()}`);
  } else {
    console.log('❌ No price data available');
  }
  process.exit(0);
};

// Main execution
const main = async (): Promise<void> => {
  try {
    // Initialize database connection first
    await initDB();

    const args = process.argv.slice(2);

    if (args.includes('--once') || args.includes('-o')) {
      await runOnce();
    } else if (args.includes('--show') || args.includes('-s')) {
      await showCurrentPrice();
    } else if (args.includes('--help') || args.includes('-h')) {
      const currencySymbol = currencyConfig?.symbol || 'CRYPTO';
      console.log(`
💰 ${currencySymbol} Price Tool

Usage:
  npm run price                    # Start continuous monitoring
  npm run price -- --once         # Run one-time update
  npm run price -- --show         # Show current price
  npm run price -- --help         # Show this help

Options:
  --once, -o    Run one-time price update
  --show, -s    Show current price from database
  --help, -h    Show this help message
    `);
      process.exit(0);
    } else {
      await startPriceMonitoring();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`💥 Fatal error: ${errorMessage}`);
    process.exit(1);
  }
};

export { main };

if (require.main === module) {
  main();
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Price monitoring stopped');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Price monitoring stopped');
  process.exit(0);
});
