#!/usr/bin/env node
/**
 * Price & DEX Swap Sync Tool (Optimized)
 *
 * Price sources (priority order, each switched in `currency.priceApi`):
 * 1. CoinGecko (if enabled)
 * 2. CoinMarketCap (if enabled)
 * 3. Coinpaprika (if enabled)
 * 4. DEX on-chain price (unless disabled): the wrapped native / stablecoin pool
 */

import '../lib/env'; // .env / .env.local before any other module reads process.env
import { Market, DexSwap } from '../models/index';
import mongoose from 'mongoose';
import { connectDB, ensureIndexesOnStartup } from '../models/index';
import {
  loadConfig,
  getCurrencyConfig,
  getFeatures,
  AppConfig,
  CurrencyConfig,
} from '../lib/config';
import { loadDexSettingsFromChain } from '../lib/dex/cache-service';
import { formatUnits, parseAbiItem } from 'viem';
import { callContract, getClient } from '../lib/web3/provider';
import {
  PAIR_VIEW_ABI,
  configuredAddress,
  isNativeStablePair,
  nativePriceFromReserves,
} from '../lib/dex/native-price';

// Configuration
const config: AppConfig = loadConfig();
const currencyConfig: CurrencyConfig = getCurrencyConfig();

// Sync Configuration
const DEX_BATCH_SIZE = 500; // Reduced for better memory usage
const DEX_SYNC_INTERVAL = 15000; // 15 seconds
const PRICE_UPDATE_INTERVAL = config.priceUpdateInterval || 5 * 60 * 1000;
const MEMORY_LIMIT_MB = parseInt(process.env.MEMORY_LIMIT_MB || '256');

// ABIs (minimal)
const SWAP_EVENT = parseAbiItem(
  'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)'
);
const ERC20_ABI = ['function decimals() external view returns (uint8)'];

// ============================================
// Singleton Instances (avoid recreation)
// ============================================
let dbInitialized = false;

// ============================================
// Caches
// ============================================
type PriceSource = 'coingecko' | 'cmc' | 'coinpaprika' | 'dex';

interface Quote {
  quoteUSD: number;
  quoteBTC: number;
}

interface PriceData extends Quote {
  symbol: string;
  timestamp: number;
  /** Where the quote was read from; stored with the Market row. */
  source?: PriceSource;
}

interface PairInfo {
  token0: string;
  token1: string;
  decimals0: number;
  decimals1: number;
}

const priceCache: { data: PriceData | null; timestamp: number } = { data: null, timestamp: 0 };
const pairInfoCache = new Map<string, PairInfo>();
const tokenPriceCache = new Map<string, { price: number; timestamp: number }>();
const PRICE_CACHE_TTL = 60000; // 1 minute
const PAIR_INFO_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const TOKEN_PRICE_CACHE_TTL = 60000; // 1 minute

// ============================================
// Utility Functions
// ============================================
const log = (msg: string) => {
  if (!(config.quiet || config.general?.quiet)) console.log(msg);
};

const checkMemory = (): boolean => {
  const usedMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  if (usedMB > MEMORY_LIMIT_MB) {
    log(`⚠️ Memory: ${usedMB}MB/${MEMORY_LIMIT_MB}MB`);
    if (global.gc) global.gc();
    return false;
  }
  return true;
};

const initDB = async (): Promise<void> => {
  if (dbInitialized && mongoose.connection.readyState === 1) return;

  try {
    await connectDB();
    let retries = 0;
    while (mongoose.connection.readyState !== 1 && retries < 30) {
      await new Promise((r) => setTimeout(r, 1000));
      retries++;
    }
    if (mongoose.connection.readyState !== 1) throw new Error('DB connection timeout');
    dbInitialized = true;
    log('🔗 Database connected');

    // Create any schema-declared index that is still missing (never drops, never throws)
    await ensureIndexesOnStartup('price');
  } catch (error) {
    console.error('❌ DB connection failed:', error);
    throw error;
  }
};

function getLPAddresses(): string[] {
  const lpTokens = (config.dex?.lpTokens || {}) as Record<string, { address: string }>;
  const farmPools = (config.dex?.farmPools || []) as Array<{ lpToken: string }>;
  const addresses = new Set<string>();
  Object.values(lpTokens).forEach((lp) => addresses.add(lp.address.toLowerCase()));
  farmPools.forEach((pool) => addresses.add(pool.lpToken.toLowerCase()));
  return Array.from(addresses);
}

// ============================================
// Price Fetching
// ============================================

// 1. CoinGecko API
const fetchCoinGeckoPrice = async (): Promise<Quote | null> => {
  if (!currencyConfig?.priceApi?.coingecko?.enabled) return null;

  try {
    const coinId = currencyConfig.priceApi.coingecko.id;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=btc,usd`,
      {
        signal: controller.signal,
        headers: { 'User-Agent': 'VBC-Explorer/1.0', Accept: 'application/json' },
      }
    );
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as Record<string, { btc?: number; usd?: number }>;
      if (data[coinId]) {
        const price = { quoteUSD: data[coinId].usd || 0, quoteBTC: data[coinId].btc || 0 };
        if (price.quoteUSD > 0) {
          log(`✅ CoinGecko: $${price.quoteUSD}`);
          return price;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
};

// 2. CoinMarketCap API
const fetchCMCPrice = async (): Promise<Quote | null> => {
  if (!currencyConfig?.priceApi?.cmc?.enabled) return null;

  try {
    const coinId = currencyConfig.priceApi.cmc.id;
    const apiKey = process.env.CMC_API_KEY;

    // CMC requires API key
    if (!apiKey) {
      log('⚠️ CMC: API key not configured (set CMC_API_KEY env var)');
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(
      `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?slug=${coinId}&convert=USD,BTC`,
      {
        signal: controller.signal,
        headers: {
          'X-CMC_PRO_API_KEY': apiKey,
          Accept: 'application/json',
        },
      }
    );
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const coinData = Object.values(data.data || {})[0] as {
        quote?: { USD?: { price?: number }; BTC?: { price?: number } };
      };
      if (coinData?.quote?.USD?.price) {
        const price = {
          quoteUSD: coinData.quote.USD.price || 0,
          quoteBTC: coinData.quote.BTC?.price || 0,
        };
        if (price.quoteUSD > 0) {
          log(`✅ CMC: $${price.quoteUSD}`);
          return price;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
};

// 3. Coinpaprika API
const fetchCoinpaprikaPrice = async (): Promise<Quote | null> => {
  if (!currencyConfig?.priceApi?.coinpaprika?.enabled) return null;

  try {
    const coinId = currencyConfig.priceApi.coinpaprika.id;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`https://api.coinpaprika.com/v1/tickers/${coinId}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'VBC-Explorer/1.0', Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as {
        quotes?: { USD?: { price?: number }; BTC?: { price?: number } };
      };
      if (data.quotes?.USD?.price) {
        const price = {
          quoteUSD: data.quotes.USD.price || 0,
          quoteBTC: data.quotes.BTC?.price || 0,
        };
        if (price.quoteUSD > 0) {
          log(`✅ Coinpaprika: $${price.quoteUSD}`);
          return price;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
};

// 4. DEX on-chain price: the wrapped native / stablecoin pool
const fetchDexPrice = async (): Promise<Quote | null> => {
  const dexPrice = currencyConfig?.priceApi?.dex;
  // the DEX source needs the DEX itself (dex.enabled), which a plain block explorer has not
  if (!getFeatures().dex || dexPrice?.enabled === false) return null;

  const wrappedNative = configuredAddress(config.dex?.wrappedNative?.address);
  const stablecoin =
    configuredAddress(dexPrice?.stablecoinAddress) ??
    configuredAddress(config.dex?.tokens?.usdt?.address);
  if (!wrappedNative || !stablecoin) return null;

  // The configured pair first, then every known pool
  const configuredPair = configuredAddress(dexPrice?.pairAddress);
  const candidates = new Set<string>(configuredPair ? [configuredPair] : []);
  getLPAddresses().forEach((address) => candidates.add(address));

  for (const lpAddress of candidates) {
    try {
      const pairInfo = await getPairInfo(lpAddress);
      if (!pairInfo || !isNativeStablePair(pairInfo, wrappedNative, stablecoin)) continue;

      const reserves = await callContract(PAIR_VIEW_ABI, lpAddress, 'getReserves');
      const quoteUSD = nativePriceFromReserves(
        { ...pairInfo, reserve0: reserves[0], reserve1: reserves[1] },
        wrappedNative,
        stablecoin
      );
      if (quoteUSD !== null) {
        log(`✅ DEX: $${quoteUSD.toFixed(8)}`);
        // the pool quotes the coin in the stablecoin only
        return { quoteUSD, quoteBTC: 0 };
      }
      console.warn(`⚠️ DEX price: pool ${lpAddress} holds no liquidity`);
    } catch (error) {
      // reported, not swallowed: a failure here leaves the explorer without a price
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ DEX price: could not read pool ${lpAddress}: ${reason}`);
    }
  }
  return null;
};

/**
 * Fetch price from multiple sources in priority order:
 * 1. CoinGecko
 * 2. CoinMarketCap (CMC)
 * 3. Coinpaprika
 * 4. DEX
 */
const PRICE_SOURCES: Array<{
  source: PriceSource;
  fetch: (symbol: string) => Promise<Quote | null>;
}> = [
  { source: 'coingecko', fetch: () => fetchCoinGeckoPrice() },
  { source: 'cmc', fetch: () => fetchCMCPrice() },
  { source: 'coinpaprika', fetch: () => fetchCoinpaprikaPrice() },
  { source: 'dex', fetch: () => fetchDexPrice() },
];

const fetchCryptoPrice = async (): Promise<PriceData | null> => {
  const symbol = currencyConfig?.symbol;
  if (!symbol) return null;

  // Check cache
  if (priceCache.data && Date.now() - priceCache.timestamp < PRICE_CACHE_TTL) {
    return priceCache.data;
  }

  for (const { source, fetch: fetchQuote } of PRICE_SOURCES) {
    const quote = await fetchQuote(symbol);
    if (quote && quote.quoteUSD > 0) {
      const result: PriceData = { symbol, timestamp: Date.now(), ...quote, source };
      priceCache.data = result;
      priceCache.timestamp = Date.now();
      return result;
    }
  }

  return null;
};

// ============================================
// DEX Swap Sync
// ============================================
async function getPairInfo(pairAddress: string): Promise<PairInfo | null> {
  const cached = pairInfoCache.get(pairAddress);
  if (cached) return cached;

  try {
    const [token0, token1] = await Promise.all([
      callContract(PAIR_VIEW_ABI, pairAddress, 'token0'),
      callContract(PAIR_VIEW_ABI, pairAddress, 'token1'),
    ]);
    const [decimals0, decimals1] = await Promise.all([
      callContract(ERC20_ABI, token0, 'decimals'),
      callContract(ERC20_ABI, token1, 'decimals'),
    ]);

    const info: PairInfo = {
      token0: token0.toLowerCase(),
      token1: token1.toLowerCase(),
      decimals0: Number(decimals0),
      decimals1: Number(decimals1),
    };
    pairInfoCache.set(pairAddress, info);

    // Clear old cache entries periodically
    if (pairInfoCache.size > 50) {
      const keys = Array.from(pairInfoCache.keys());
      keys.slice(0, 10).forEach((k) => pairInfoCache.delete(k));
    }

    return info;
  } catch {
    return null;
  }
}

/**
 * Get token price in USD from pool data
 * Caches prices to avoid repeated RPC calls
 */
async function getTokenPriceFromPool(tokenAddress: string, nativePrice: number): Promise<number> {
  const normalized = tokenAddress.toLowerCase();
  const usdt = (config.dex?.tokens?.usdt?.address || '').toLowerCase();
  const wrappedNative = (config.dex?.wrappedNative?.address || '').toLowerCase();

  // Stablecoin
  if (normalized === usdt) return 1.0;

  // Wrapped native
  if (normalized === wrappedNative) return nativePrice;

  // Check cache
  const cached = tokenPriceCache.get(normalized);
  if (cached && Date.now() - cached.timestamp < TOKEN_PRICE_CACHE_TTL) {
    return cached.price;
  }

  // Look through pools to find price
  const lpAddresses = getLPAddresses();

  for (const lpAddress of lpAddresses) {
    try {
      const pairInfo = await getPairInfo(lpAddress);
      if (!pairInfo) continue;

      const { token0, token1, decimals0, decimals1 } = pairInfo;
      const isToken0 = token0 === normalized;
      const isToken1 = token1 === normalized;

      if (!isToken0 && !isToken1) continue;

      const pairedToken = isToken0 ? token1 : token0;

      // Get reserves
      const reserves = await callContract(PAIR_VIEW_ABI, lpAddress, 'getReserves');
      const r0 = Number(formatUnits(BigInt(reserves[0]), decimals0));
      const r1 = Number(formatUnits(BigInt(reserves[1]), decimals1));

      if (r0 <= 0 || r1 <= 0) continue;

      // Calculate price based on paired token
      let price = 0;

      if (pairedToken === usdt) {
        // Paired with stablecoin
        price = isToken0 ? r1 / r0 : r0 / r1;
      } else if (pairedToken === wrappedNative && nativePrice > 0) {
        // Paired with wrapped native
        const priceInNative = isToken0 ? r1 / r0 : r0 / r1;
        price = priceInNative * nativePrice;
      }

      if (price > 0) {
        tokenPriceCache.set(normalized, { price, timestamp: Date.now() });
        return price;
      }
    } catch {
      continue;
    }
  }

  // Cache 0 price to avoid repeated lookups
  tokenPriceCache.set(normalized, { price: 0, timestamp: Date.now() });
  return 0;
}

async function getLastSyncedBlock(pairAddress: string): Promise<number> {
  const last = await DexSwap.findOne({ pair: pairAddress })
    .sort({ blockNumber: -1 })
    .select('blockNumber')
    .lean();
  return last?.blockNumber || 0;
}

async function processSwapEvents(
  pairAddress: string,
  fromBlock: number,
  toBlock: number,
  nativePrice: number
): Promise<number> {
  const pairInfo = await getPairInfo(pairAddress);
  if (!pairInfo) return 0;

  const { token0, token1, decimals0, decimals1 } = pairInfo;
  const wrappedNative = (config.dex?.wrappedNative?.address || '').toLowerCase();
  const usdt = (config.dex?.tokens?.usdt?.address || '').toLowerCase();

  try {
    const events = await getClient().getLogs({
      address: pairAddress as `0x${string}`,
      event: SWAP_EVENT,
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
      // only logs that decode as the Swap event
      strict: true,
    });
    if (events.length === 0) return 0;

    log(`  ${pairAddress.slice(0, 10)}... ${events.length} swaps`);

    // Batch process events
    const bulkOps = [];

    for (const event of events) {
      try {
        const block = await getClient()
          .getBlock({ blockNumber: event.blockNumber })
          .catch(() => null);
        if (!block) continue;

        const { sender, to, amount0In, amount1In, amount0Out, amount1Out } = event.args;

        const a0In = Number(formatUnits(BigInt(amount0In), decimals0));
        const a1In = Number(formatUnits(BigInt(amount1In), decimals1));
        const a0Out = Number(formatUnits(BigInt(amount0Out), decimals0));
        const a1Out = Number(formatUnits(BigInt(amount1Out), decimals1));

        // Calculate amountUSD based on token types
        let amountUSD = 0;
        if (token0 === usdt) {
          // Token0 is stablecoin - use its amount directly
          amountUSD = Math.max(a0In, a0Out);
        } else if (token1 === usdt) {
          // Token1 is stablecoin - use its amount directly
          amountUSD = Math.max(a1In, a1Out);
        } else if (token0 === wrappedNative) {
          // Token0 is native - use native price
          amountUSD = Math.max(a0In, a0Out) * nativePrice;
        } else if (token1 === wrappedNative) {
          // Token1 is native - use native price
          amountUSD = Math.max(a1In, a1Out) * nativePrice;
        } else {
          // Neither token is stablecoin or native
          // Get actual token prices from pools
          try {
            const [price0, price1] = await Promise.all([
              getTokenPriceFromPool(token0, nativePrice),
              getTokenPriceFromPool(token1, nativePrice),
            ]);

            const usd0 = Math.max(a0In, a0Out) * price0;
            const usd1 = Math.max(a1In, a1Out) * price1;

            // Use the maximum of the two sides as volume
            amountUSD = Math.max(usd0, usd1);
          } catch {
            // If price lookup fails, use 0
            amountUSD = 0;
          }
        }

        bulkOps.push({
          updateOne: {
            filter: { hash: event.transactionHash, pair: pairAddress },
            update: {
              $set: {
                hash: event.transactionHash,
                blockNumber: Number(event.blockNumber),
                timestamp: Number(block.timestamp),
                pair: pairAddress,
                sender: sender.toLowerCase(),
                to: to.toLowerCase(),
                amount0In: amount0In.toString(),
                amount1In: amount1In.toString(),
                amount0Out: amount0Out.toString(),
                amount1Out: amount1Out.toString(),
                token0,
                token1,
                amountUSD,
                priceUSD: nativePrice,
              },
            },
            upsert: true,
          },
        });
      } catch {
        // Skip problematic event
      }
    }

    // Bulk write for better performance
    if (bulkOps.length > 0) {
      await DexSwap.bulkWrite(bulkOps, { ordered: false });
    }

    return events.length;
  } catch (error) {
    console.error(`Error processing ${pairAddress}:`, error);
    return 0;
  }
}

const syncDexSwaps = async (nativePrice: number): Promise<void> => {
  if (!getFeatures().dex || !checkMemory()) return;

  const lpAddresses = getLPAddresses();
  if (lpAddresses.length === 0) return;

  try {
    const currentBlock = Number(await getClient().getBlockNumber());
    let totalEvents = 0;

    for (const pairAddress of lpAddresses) {
      const lastBlock = await getLastSyncedBlock(pairAddress);
      const startBlock = lastBlock > 0 ? lastBlock + 1 : currentBlock - 5000;

      if (startBlock > currentBlock) continue;

      for (let from = startBlock; from <= currentBlock; from += DEX_BATCH_SIZE) {
        const to = Math.min(from + DEX_BATCH_SIZE - 1, currentBlock);
        totalEvents += await processSwapEvents(pairAddress, from, to, nativePrice);

        // Memory check between batches
        if (!checkMemory()) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    if (totalEvents > 0) log(`✅ Synced ${totalEvents} swaps`);
  } catch (error) {
    console.error('❌ DEX sync error:', error);
  }
};

// ============================================
// Database Operations
// ============================================
const updatePriceData = async (data: PriceData): Promise<void> => {
  try {
    await new Market(data).save();
    log(`💰 ${data.symbol}: $${data.quoteUSD}`);
  } catch (error) {
    console.error('❌ Price save error:', error);
  }
};

const getLatestPrice = async (): Promise<PriceData | null> => {
  try {
    return await Market.findOne().sort({ timestamp: -1 }).lean();
  } catch {
    return null;
  }
};

// ============================================
// Main Functions
// ============================================
const startPriceMonitoring = async (): Promise<void> => {
  const symbol = currencyConfig?.symbol || 'CRYPTO';
  console.log(`💰 Starting ${symbol} price monitoring`);
  console.log(`⏰ Price: ${PRICE_UPDATE_INTERVAL / 1000}s, DEX: ${DEX_SYNC_INTERVAL / 1000}s`);

  let lastPrice = 0;

  // Initial fetch
  const initial = await fetchCryptoPrice();
  if (initial) {
    await updatePriceData(initial);
    lastPrice = initial.quoteUSD;
    await syncDexSwaps(lastPrice);
  }

  // Price updates
  setInterval(async () => {
    try {
      const price = await fetchCryptoPrice();
      if (price) {
        await updatePriceData(price);
        lastPrice = price.quoteUSD;
      }
    } catch (e) {
      console.error('❌ Price update error:', e);
    }
  }, PRICE_UPDATE_INTERVAL);

  // DEX sync
  setInterval(async () => {
    if (lastPrice > 0) await syncDexSwaps(lastPrice);
  }, DEX_SYNC_INTERVAL);
};

const runOnce = async (): Promise<void> => {
  log('🔄 One-time sync...');
  const price = await fetchCryptoPrice();
  if (price) {
    await updatePriceData(price);
    await syncDexSwaps(price.quoteUSD);
  }
  process.exit(0);
};

const showCurrentPrice = async (): Promise<void> => {
  const latest = await getLatestPrice();
  if (latest) {
    console.log(`💰 ${latest.symbol}: $${latest.quoteUSD} (${latest.quoteBTC} BTC)`);
    console.log(`🕐 Updated: ${new Date(latest.timestamp).toLocaleString()}`);
  } else {
    console.log('❌ No price data');
  }
  process.exit(0);
};

// Main
/** Price monitoring, or a one-off with a flag; the worker calls it with no arguments. */
const main = async (args: string[] = process.argv.slice(2)): Promise<void> => {
  await initDB();
  // run alone, the DEX settings config.json leaves out are read here (the worker reads them first)
  if (getFeatures().dex) await loadDexSettingsFromChain({ onlyIfMissing: true });

  if (args.includes('--once') || args.includes('-o')) {
    await runOnce();
  } else if (args.includes('--show') || args.includes('-s')) {
    await showCurrentPrice();
  } else if (args.includes('--help') || args.includes('-h')) {
    console.log(`
💰 Price & DEX Sync Tool

Usage:
  npm run price              # Start monitoring
  npm run price -- --once    # One-time sync
  npm run price -- --show    # Show current price
  npm run price -- --help    # Help
    `);
    process.exit(0);
  } else {
    await startPriceMonitoring();
  }
};

export { main };
if (require.main === module) {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      console.log('\n🛑 Stopped');
      process.exit(0);
    });
  }
  main().catch(() => process.exit(1));
}
