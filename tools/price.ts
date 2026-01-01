#!/usr/bin/env node
/*
Tool for fetching and updating cryptocurrency price data
Also syncs DEX swap events for volume and transaction statistics

Price sources (in priority order):
1. Exbitron Exchange API
2. CoinGecko (if configured)
3. CoinPaprika (if configured)
4. DEX on-chain price (fallback)
*/

import { Market, DexSwap } from '../models/index';
import mongoose from 'mongoose';
import { connectDB } from '../models/index';
import { loadConfig, getCurrencyConfig, AppConfig, CurrencyConfig } from '../lib/config';
import { ethers, EventLog } from 'ethers';

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
interface PriceData {
  symbol: string;
  timestamp: number;
  quoteBTC: number;
  quoteUSD: number;
}

// Configuration
const config: AppConfig = loadConfig();
const currencyConfig: CurrencyConfig = getCurrencyConfig();

// DEX Sync Configuration
const DEX_BATCH_SIZE = 1000; // Blocks to process at once
const DEX_SYNC_INTERVAL = 15000; // 15 seconds for DEX sync
const PRICE_UPDATE_INTERVAL = config.priceUpdateInterval || 5 * 60 * 1000; // 5 minutes default

// Uniswap V2 Pair ABI (Swap event)
const PAIR_ABI = [
  'event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
];

const ERC20_ABI = ['function decimals() external view returns (uint8)'];

// Initialize database connection after config is loaded
initDB();

if (config.general?.quiet) {
  console.log('🔇 Quiet mode enabled');
}

// Price cache to avoid frequent API calls
const priceCache = new Map<string, { data: PriceData; timestamp: number }>();
const CACHE_DURATION = 60000; // 1 minute cache

/**
 * Fetch price from Exbitron exchange API
 */
const fetchExbitronPrice = async (
  symbol: string
): Promise<{ quoteUSD: number; quoteBTC: number } | null> => {
  try {
    console.log('🔄 Fetching price from Exbitron...');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch('https://api.exbitron.com/api/v1/cg/tickers', {
      signal: controller.signal,
      headers: {
        'User-Agent': 'VirBiCoin-Explorer/1.0',
        Accept: 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const tickers = await response.json();

    // Find native token / USDT ticker (e.g., VBC-USDT)
    const nativeUsdt = tickers.find((t: { ticker_id: string }) => t.ticker_id === `${symbol}-USDT`);

    // Find native token / BTC ticker (e.g., VBC-BTC)
    const nativeBtc = tickers.find((t: { ticker_id: string }) => t.ticker_id === `${symbol}-BTC`);

    if (nativeUsdt?.last_price || nativeBtc?.last_price) {
      const quoteUSD = nativeUsdt?.last_price ? parseFloat(nativeUsdt.last_price) : 0;
      const quoteBTC = nativeBtc?.last_price ? parseFloat(nativeBtc.last_price) : 0;
      console.log(`✅ Exbitron price: $${quoteUSD} USD, ${quoteBTC} BTC`);
      return { quoteUSD, quoteBTC };
    }

    return null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`❌ Failed to fetch from Exbitron: ${errorMessage}`);
    return null;
  }
};

/**
 * Fetch price from DEX on-chain (VBC/USDT pool)
 */
const fetchDexPrice = async (): Promise<{ quoteUSD: number; quoteBTC: number } | null> => {
  try {
    console.log('🔄 Fetching price from DEX...');

    const provider = new ethers.JsonRpcProvider(config.network?.rpcUrl || config.web3Provider?.url);

    const wrappedNativeAddress = config.dex?.wrappedNative?.address?.toLowerCase();
    const usdtAddress = config.dex?.tokens?.usdt?.address?.toLowerCase();

    if (!wrappedNativeAddress || !usdtAddress) {
      console.log('⚠️ DEX token addresses not configured');
      return null;
    }

    // Get all LP addresses
    const lpTokens = (config.dex?.lpTokens || {}) as Record<string, { address: string }>;
    const farmPools = (config.dex?.farmPools || []) as Array<{ lpToken: string }>;

    const lpAddresses = new Set<string>();
    Object.values(lpTokens).forEach((lp) => lpAddresses.add(lp.address.toLowerCase()));
    farmPools.forEach((pool) => lpAddresses.add(pool.lpToken.toLowerCase()));

    // Find VBC/USDT pool
    for (const lpAddress of lpAddresses) {
      try {
        const pairContract = new ethers.Contract(lpAddress, PAIR_ABI, provider);
        const [token0Address, token1Address, reserves] = await Promise.all([
          pairContract.token0(),
          pairContract.token1(),
          pairContract.getReserves(),
        ]);

        const isVbcUsdtPool =
          (token0Address.toLowerCase() === wrappedNativeAddress &&
            token1Address.toLowerCase() === usdtAddress) ||
          (token1Address.toLowerCase() === wrappedNativeAddress &&
            token0Address.toLowerCase() === usdtAddress);

        if (isVbcUsdtPool) {
          const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
          const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);
          const [decimals0, decimals1] = await Promise.all([
            token0Contract.decimals(),
            token1Contract.decimals(),
          ]);

          const reserve0 = Number(ethers.formatUnits(reserves[0], decimals0));
          const reserve1 = Number(ethers.formatUnits(reserves[1], decimals1));

          let quoteUSD: number;
          if (token0Address.toLowerCase() === usdtAddress) {
            quoteUSD = reserve0 / reserve1; // USDT / VBC
          } else {
            quoteUSD = reserve1 / reserve0; // USDT / VBC
          }

          console.log(`✅ DEX price: $${quoteUSD.toFixed(8)} USD`);
          return { quoteUSD, quoteBTC: 0 };
        }
      } catch {
        // Skip this pair
      }
    }

    return null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`❌ Failed to fetch from DEX: ${errorMessage}`);
    return null;
  }
};

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
      if (!config.general?.quiet) {
        console.log(`📋 Using cached price data for ${currency.symbol}`);
      }
      return cached.data;
    }

    // Priority 1: Exbitron Exchange
    const exbitronPrice = await fetchExbitronPrice(currency.symbol);
    if (exbitronPrice && exbitronPrice.quoteUSD > 0) {
      const priceResult = {
        symbol: currency.symbol,
        timestamp: Date.now(),
        quoteBTC: exbitronPrice.quoteBTC,
        quoteUSD: exbitronPrice.quoteUSD,
      };
      priceCache.set(cacheKey, { data: priceResult, timestamp: Date.now() });
      return priceResult;
    }

    // Priority 2: CoinGecko/CoinPaprika (if configured)
    const priceSources: Array<{
      name: string;
      url: string;
      parser: (data: unknown) => { quoteBTC: number; quoteUSD: number } | null;
    }> = [];

    if (currency.priceApi?.coingecko?.enabled) {
      priceSources.push({
        name: 'CoinGecko',
        url: `https://api.coingecko.com/api/v3/simple/price?ids=${currency.priceApi.coingecko.id}&vs_currencies=btc,usd`,
        parser: (data: unknown) => {
          const coinId = currency.priceApi?.coingecko?.id;
          const d = data as Record<string, { btc?: number; usd?: number }>;
          if (coinId && d[coinId]) {
            return {
              quoteBTC: d[coinId].btc || 0,
              quoteUSD: d[coinId].usd || 0,
            };
          }
          return null;
        },
      });
    }

    if (currency.priceApi?.coinpaprika?.enabled) {
      priceSources.push({
        name: 'CoinPaprika',
        url: `https://api.coinpaprika.com/v1/tickers/${currency.priceApi.coinpaprika.id}`,
        parser: (data: unknown) => {
          const d = data as { quotes?: { BTC?: { price?: number }; USD?: { price?: number } } };
          return {
            quoteBTC: d.quotes?.BTC?.price || 0,
            quoteUSD: d.quotes?.USD?.price || 0,
          };
        },
      });
    }

    for (const source of priceSources) {
      try {
        console.log(`🔄 Fetching price from ${source.name}...`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const response = await fetch(source.url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'VirBiCoin-Explorer/1.0',
            Accept: 'application/json',
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
            `✅ ${source.name} price: $${priceData.quoteUSD} USD, ${priceData.quoteBTC} BTC`
          );
          const priceResult = {
            symbol: currency.symbol,
            timestamp: Date.now(),
            quoteBTC: priceData.quoteBTC,
            quoteUSD: priceData.quoteUSD,
          };
          priceCache.set(cacheKey, { data: priceResult, timestamp: Date.now() });
          return priceResult;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`❌ Failed to fetch from ${source.name}: ${errorMessage}`);
      }
    }

    // Priority 3: DEX on-chain price
    const dexPrice = await fetchDexPrice();
    if (dexPrice && dexPrice.quoteUSD > 0) {
      const priceResult = {
        symbol: currency.symbol,
        timestamp: Date.now(),
        quoteBTC: dexPrice.quoteBTC,
        quoteUSD: dexPrice.quoteUSD,
      };
      priceCache.set(cacheKey, { data: priceResult, timestamp: Date.now() });
      return priceResult;
    }

    // No price available
    console.log('⚠️ No price data available from any source');
    return null;
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

// ============================================
// DEX Swap Sync Functions
// ============================================

/**
 * Get LP token addresses from config
 */
function getLPAddresses(): string[] {
  const lpTokens = (config.dex?.lpTokens || {}) as Record<string, { address: string }>;
  const farmPools = (config.dex?.farmPools || []) as Array<{ lpToken: string }>;

  const addresses = new Set<string>();
  Object.values(lpTokens).forEach((lp) => addresses.add(lp.address.toLowerCase()));
  farmPools.forEach((pool) => addresses.add(pool.lpToken.toLowerCase()));

  return Array.from(addresses);
}

/**
 * Get last synced block for a pair
 */
async function getLastSyncedBlock(pairAddress: string): Promise<number> {
  const lastSwap = await DexSwap.findOne({ pair: pairAddress.toLowerCase() })
    .sort({ blockNumber: -1 })
    .limit(1);
  return lastSwap?.blockNumber || 0;
}

/**
 * Process swap events for a pair
 */
async function processSwapEvents(
  provider: ethers.JsonRpcProvider,
  pairAddress: string,
  fromBlock: number,
  toBlock: number,
  vbcPrice: number,
  wrappedNativeAddress: string,
  usdtAddress: string
): Promise<number> {
  const pairContract = new ethers.Contract(pairAddress, PAIR_ABI, provider);

  try {
    const [token0Address, token1Address] = await Promise.all([
      pairContract.token0(),
      pairContract.token1(),
    ]);

    const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
    const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);

    const [decimals0, decimals1] = await Promise.all([
      token0Contract.decimals(),
      token1Contract.decimals(),
    ]);

    const filter = pairContract.filters.Swap();
    const events = await pairContract.queryFilter(filter, fromBlock, toBlock);

    if (events.length > 0 && !config.general?.quiet) {
      console.log(`  Found ${events.length} swap events for ${pairAddress.slice(0, 10)}...`);
    }

    for (const event of events) {
      try {
        if (!(event instanceof EventLog) || !event.args) continue;

        const block = await provider.getBlock(event.blockNumber);
        if (!block) continue;

        const args = event.args;

        const amount0In = Number(ethers.formatUnits(args.amount0In, decimals0));
        const amount1In = Number(ethers.formatUnits(args.amount1In, decimals1));
        const amount0Out = Number(ethers.formatUnits(args.amount0Out, decimals0));
        const amount1Out = Number(ethers.formatUnits(args.amount1Out, decimals1));

        let amountUSD = 0;
        const isToken0WVBC = token0Address.toLowerCase() === wrappedNativeAddress;
        const isToken1WVBC = token1Address.toLowerCase() === wrappedNativeAddress;
        const isToken0USDT = token0Address.toLowerCase() === usdtAddress;
        const isToken1USDT = token1Address.toLowerCase() === usdtAddress;

        if (isToken0USDT) {
          amountUSD = Math.max(amount0In, amount0Out);
        } else if (isToken1USDT) {
          amountUSD = Math.max(amount1In, amount1Out);
        } else if (isToken0WVBC) {
          amountUSD = Math.max(amount0In, amount0Out) * vbcPrice;
        } else if (isToken1WVBC) {
          amountUSD = Math.max(amount1In, amount1Out) * vbcPrice;
        }

        await DexSwap.findOneAndUpdate(
          { hash: event.transactionHash, pair: pairAddress.toLowerCase() },
          {
            hash: event.transactionHash,
            blockNumber: event.blockNumber,
            timestamp: block.timestamp,
            pair: pairAddress.toLowerCase(),
            sender: args.sender.toLowerCase(),
            to: args.to.toLowerCase(),
            amount0In: args.amount0In.toString(),
            amount1In: args.amount1In.toString(),
            amount0Out: args.amount0Out.toString(),
            amount1Out: args.amount1Out.toString(),
            token0: token0Address.toLowerCase(),
            token1: token1Address.toLowerCase(),
            amountUSD,
            priceUSD: vbcPrice,
          },
          { upsert: true, new: true }
        );
      } catch (eventError) {
        console.error(`  Error processing swap event:`, eventError);
      }
    }

    return events.length;
  } catch (error) {
    console.error(`Error processing pair ${pairAddress}:`, error);
    return 0;
  }
}

/**
 * Sync DEX swap events
 */
const syncDexSwaps = async (vbcPrice: number): Promise<void> => {
  try {
    if (!checkMemory()) {
      console.log('💾 Memory limit reached, skipping DEX sync');
      return;
    }

    const lpAddresses = getLPAddresses();
    if (lpAddresses.length === 0) {
      if (!config.general?.quiet) {
        console.log('⚠️ No LP addresses configured for DEX sync');
      }
      return;
    }

    const provider = new ethers.JsonRpcProvider(config.network?.rpcUrl || config.web3Provider?.url);

    const currentBlock = await provider.getBlockNumber();
    const wrappedNativeAddress = (config.dex?.wrappedNative?.address || '').toLowerCase();
    const usdtAddress = (config.dex?.tokens?.usdt?.address || '').toLowerCase();

    if (!config.general?.quiet) {
      console.log(`🔄 Syncing DEX swaps for ${lpAddresses.length} pairs...`);
    }

    let totalEvents = 0;

    for (const pairAddress of lpAddresses) {
      const lastBlock = await getLastSyncedBlock(pairAddress);
      const startBlock = lastBlock > 0 ? lastBlock + 1 : currentBlock - 10000;

      if (startBlock > currentBlock) continue;

      for (let fromBlock = startBlock; fromBlock <= currentBlock; fromBlock += DEX_BATCH_SIZE) {
        const toBlock = Math.min(fromBlock + DEX_BATCH_SIZE - 1, currentBlock);

        if (!config.general?.quiet) {
          console.log(`  Processing ${pairAddress.slice(0, 10)}... blocks ${fromBlock}-${toBlock}`);
        }

        const events = await processSwapEvents(
          provider,
          pairAddress,
          fromBlock,
          toBlock,
          vbcPrice,
          wrappedNativeAddress,
          usdtAddress
        );
        totalEvents += events;
      }
    }

    if (!config.general?.quiet && totalEvents > 0) {
      console.log(`✅ DEX sync complete: ${totalEvents} events`);
    }
  } catch (error) {
    console.error('❌ Error syncing DEX swaps:', error);
  }
};

/**
 * Continuous price monitoring with improved error handling
 */
const startPriceMonitoring = async (): Promise<void> => {
  const currencySymbol = currencyConfig?.symbol || 'CRYPTO';
  console.log(`💰 Starting ${currencySymbol} price monitoring...`);
  console.log(`📊 DEX swap sync enabled`);
  console.log(`⏰ Price update interval: ${PRICE_UPDATE_INTERVAL / 1000} seconds`);
  console.log(`⏰ DEX sync interval: ${DEX_SYNC_INTERVAL / 1000} seconds`);

  // Track last price for DEX sync
  let lastPriceUSD = 0;

  // Initial price fetch
  const initialPrice = await fetchCryptoPrice();
  if (initialPrice) {
    await updatePriceData(initialPrice);
    lastPriceUSD = initialPrice.quoteUSD;
  }

  // Initial DEX sync
  if (lastPriceUSD > 0) {
    await syncDexSwaps(lastPriceUSD);
  }

  // Set up periodic price updates (every 5 minutes)
  setInterval(async () => {
    try {
      const priceData = await fetchCryptoPrice();
      if (priceData) {
        await updatePriceData(priceData);
        lastPriceUSD = priceData.quoteUSD;
      }
    } catch (error) {
      console.error('❌ Error in periodic price update:', error);
    }
  }, PRICE_UPDATE_INTERVAL);

  // Set up periodic DEX sync (every 15 seconds)
  setInterval(async () => {
    try {
      if (lastPriceUSD > 0) {
        await syncDexSwaps(lastPriceUSD);
      }
    } catch (error) {
      console.error('❌ Error in periodic DEX sync:', error);
    }
  }, DEX_SYNC_INTERVAL);
};

/**
 * One-time price update with DEX sync
 */
const runOnce = async (): Promise<void> => {
  console.log('🔄 Running one-time price and DEX sync...');
  const priceData = await fetchCryptoPrice();
  if (priceData) {
    await updatePriceData(priceData);
    await syncDexSwaps(priceData.quoteUSD);
  }
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
💰 ${currencySymbol} Price & DEX Sync Tool

Usage:
  npm run price                    # Start continuous monitoring (price + DEX swaps)
  npm run price -- --once         # Run one-time update
  npm run price -- --show         # Show current price
  npm run price -- --help         # Show this help

Options:
  --once, -o    Run one-time price update and DEX sync
  --show, -s    Show current price from database
  --help, -h    Show this help message

Price Sources (priority order):
  1. Exbitron Exchange API (${currencySymbol}-USDT ticker)
  2. CoinGecko (if configured in config.json)
  3. CoinPaprika (if configured in config.json)
  4. DEX on-chain price (VBC/USDT pool)

Features:
  - Price updates every ${PRICE_UPDATE_INTERVAL / 1000} seconds
  - DEX swap sync every ${DEX_SYNC_INTERVAL / 1000} seconds
  - Volume and transaction tracking for GeckoTerminal API
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
