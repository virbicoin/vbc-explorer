#!/usr/bin/env node
/**
 * Price & DEX Swap Sync Tool (Optimized)
 *
 * Price sources (priority order):
 * 1. Exbitron Exchange API
 * 2. CoinGecko (if configured)
 * 3. DEX on-chain price (fallback)
 */

import { Market, DexSwap } from '../models/index';
import mongoose from 'mongoose';
import { connectDB } from '../models/index';
import { loadConfig, getCurrencyConfig, AppConfig, CurrencyConfig } from '../lib/config';
import { ethers, EventLog } from 'ethers';

// Configuration
const config: AppConfig = loadConfig();
const currencyConfig: CurrencyConfig = getCurrencyConfig();

// Sync Configuration
const DEX_BATCH_SIZE = 500; // Reduced for better memory usage
const DEX_SYNC_INTERVAL = 15000; // 15 seconds
const PRICE_UPDATE_INTERVAL = config.priceUpdateInterval || 5 * 60 * 1000;
const MEMORY_LIMIT_MB = parseInt(process.env.MEMORY_LIMIT_MB || '256');

// ABIs (minimal)
const PAIR_ABI = [
  'event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
];
const ERC20_ABI = ['function decimals() external view returns (uint8)'];

// ============================================
// Singleton Instances (avoid recreation)
// ============================================
let providerInstance: ethers.JsonRpcProvider | null = null;
let dbInitialized = false;

function getProvider(): ethers.JsonRpcProvider {
  if (!providerInstance) {
    providerInstance = new ethers.JsonRpcProvider(
      config.network?.rpcUrl || config.web3Provider?.url
    );
  }
  return providerInstance;
}

// ============================================
// Caches
// ============================================
interface PriceData {
  symbol: string;
  timestamp: number;
  quoteBTC: number;
  quoteUSD: number;
}

interface PairInfo {
  token0: string;
  token1: string;
  decimals0: number;
  decimals1: number;
}

const priceCache: { data: PriceData | null; timestamp: number } = { data: null, timestamp: 0 };
const pairInfoCache = new Map<string, PairInfo>();
const PRICE_CACHE_TTL = 60000; // 1 minute
const PAIR_INFO_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// ============================================
// Utility Functions
// ============================================
const log = (msg: string) => {
  if (!config.general?.quiet) console.log(msg);
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
  } catch (error) {
    console.error('❌ DB connection failed:', error);
    process.exit(1);
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
const fetchExbitronPrice = async (
  symbol: string
): Promise<{ quoteUSD: number; quoteBTC: number } | null> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch('https://api.exbitron.com/api/v1/cg/tickers', {
      signal: controller.signal,
      headers: { 'User-Agent': 'VBC-Explorer/1.0', Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const tickers = await response.json();
    const nativeUsdt = tickers.find((t: { ticker_id: string }) => t.ticker_id === `${symbol}-USDT`);
    const nativeBtc = tickers.find((t: { ticker_id: string }) => t.ticker_id === `${symbol}-BTC`);

    if (nativeUsdt?.last_price || nativeBtc?.last_price) {
      const quoteUSD = parseFloat(nativeUsdt?.last_price || '0');
      const quoteBTC = parseFloat(nativeBtc?.last_price || '0');
      log(`✅ Exbitron: $${quoteUSD}`);
      return { quoteUSD, quoteBTC };
    }
    return null;
  } catch {
    return null;
  }
};

const fetchDexPrice = async (): Promise<{ quoteUSD: number; quoteBTC: number } | null> => {
  try {
    const provider = getProvider();
    const wrappedNative = config.dex?.wrappedNative?.address?.toLowerCase();
    const usdt = config.dex?.tokens?.usdt?.address?.toLowerCase();
    if (!wrappedNative || !usdt) return null;

    for (const lpAddress of getLPAddresses()) {
      try {
        const pairInfo = await getPairInfo(lpAddress);
        if (!pairInfo) continue;

        const { token0, token1, decimals0, decimals1 } = pairInfo;
        const isVbcUsdt =
          (token0 === wrappedNative && token1 === usdt) ||
          (token1 === wrappedNative && token0 === usdt);

        if (isVbcUsdt) {
          const pairContract = new ethers.Contract(lpAddress, PAIR_ABI, provider);
          const reserves = await pairContract.getReserves();
          const r0 = Number(ethers.formatUnits(reserves[0], decimals0));
          const r1 = Number(ethers.formatUnits(reserves[1], decimals1));
          const quoteUSD = token0 === usdt ? r0 / r1 : r1 / r0;
          log(`✅ DEX: $${quoteUSD.toFixed(8)}`);
          return { quoteUSD, quoteBTC: 0 };
        }
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
};

const fetchCryptoPrice = async (): Promise<PriceData | null> => {
  const symbol = currencyConfig?.symbol;
  if (!symbol) return null;

  // Check cache
  if (priceCache.data && Date.now() - priceCache.timestamp < PRICE_CACHE_TTL) {
    return priceCache.data;
  }

  // Try Exbitron first
  let price = await fetchExbitronPrice(symbol);

  // Try CoinGecko if configured
  if (!price && currencyConfig?.priceApi?.coingecko?.enabled) {
    try {
      const coinId = currencyConfig.priceApi.coingecko.id;
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 8000);
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=btc,usd`,
        { signal: controller.signal }
      );
      if (res.ok) {
        const data = (await res.json()) as Record<string, { btc?: number; usd?: number }>;
        if (data[coinId!]) {
          price = { quoteUSD: data[coinId!].usd || 0, quoteBTC: data[coinId!].btc || 0 };
          log(`✅ CoinGecko: $${price.quoteUSD}`);
        }
      }
    } catch {
      // Ignore
    }
  }

  // Try DEX as fallback
  if (!price || price.quoteUSD === 0) {
    price = await fetchDexPrice();
  }

  if (price && price.quoteUSD > 0) {
    const result: PriceData = { symbol, timestamp: Date.now(), ...price };
    priceCache.data = result;
    priceCache.timestamp = Date.now();
    return result;
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
    const provider = getProvider();
    const pairContract = new ethers.Contract(pairAddress, PAIR_ABI, provider);
    const [token0, token1] = await Promise.all([pairContract.token0(), pairContract.token1()]);

    const token0Contract = new ethers.Contract(token0, ERC20_ABI, provider);
    const token1Contract = new ethers.Contract(token1, ERC20_ABI, provider);
    const [decimals0, decimals1] = await Promise.all([
      token0Contract.decimals(),
      token1Contract.decimals(),
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
  vbcPrice: number
): Promise<number> {
  const pairInfo = await getPairInfo(pairAddress);
  if (!pairInfo) return 0;

  const { token0, token1, decimals0, decimals1 } = pairInfo;
  const wrappedNative = (config.dex?.wrappedNative?.address || '').toLowerCase();
  const usdt = (config.dex?.tokens?.usdt?.address || '').toLowerCase();

  const provider = getProvider();
  const pairContract = new ethers.Contract(pairAddress, PAIR_ABI, provider);

  try {
    const events = await pairContract.queryFilter(pairContract.filters.Swap(), fromBlock, toBlock);
    if (events.length === 0) return 0;

    log(`  ${pairAddress.slice(0, 10)}... ${events.length} swaps`);

    // Batch process events
    const bulkOps = [];

    for (const event of events) {
      if (!(event instanceof EventLog) || !event.args) continue;

      try {
        const block = await provider.getBlock(event.blockNumber);
        if (!block) continue;

        const { sender, to, amount0In, amount1In, amount0Out, amount1Out } = event.args;

        const a0In = Number(ethers.formatUnits(amount0In, decimals0));
        const a1In = Number(ethers.formatUnits(amount1In, decimals1));
        const a0Out = Number(ethers.formatUnits(amount0Out, decimals0));
        const a1Out = Number(ethers.formatUnits(amount1Out, decimals1));

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
          amountUSD = Math.max(a0In, a0Out) * vbcPrice;
        } else if (token1 === wrappedNative) {
          // Token1 is native - use native price
          amountUSD = Math.max(a1In, a1Out) * vbcPrice;
        } else {
          // Neither token is stablecoin or native
          // Try to estimate value using pool reserves and native price
          try {
            const reserves = await pairContract.getReserves();
            const r0 = Number(ethers.formatUnits(reserves[0], decimals0));
            const r1 = Number(ethers.formatUnits(reserves[1], decimals1));

            // Estimate token value in USD by assuming 50/50 pool value
            // If we have any activity, use the larger amount * estimated price
            const maxAmount0 = Math.max(a0In, a0Out);
            const maxAmount1 = Math.max(a1In, a1Out);

            // Use the ratio and VBC price as a rough estimate
            // Assumption: total pool value ≈ TVL, so each side ≈ TVL/2
            // This is a fallback estimation when we can't directly price
            if (r0 > 0 && r1 > 0 && vbcPrice > 0) {
              // Try to find the pool's TVL via another pair
              // For now, use a simple heuristic: assume larger movement has more info
              const ratio = r0 > 0 ? maxAmount0 / r0 : 0;
              // Rough estimate: consider this as percentage of pool moved
              // If we knew the pool's USD value, we could multiply
              // Fallback: just use the native token value estimation
              amountUSD = Math.max(maxAmount0, maxAmount1) * vbcPrice * 0.5;
            }
          } catch {
            // If reserves fetch fails, use 0
            amountUSD = 0;
          }
        }

        bulkOps.push({
          updateOne: {
            filter: { hash: event.transactionHash, pair: pairAddress },
            update: {
              $set: {
                hash: event.transactionHash,
                blockNumber: event.blockNumber,
                timestamp: block.timestamp,
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
                priceUSD: vbcPrice,
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

const syncDexSwaps = async (vbcPrice: number): Promise<void> => {
  if (!checkMemory()) return;

  const lpAddresses = getLPAddresses();
  if (lpAddresses.length === 0) return;

  try {
    const provider = getProvider();
    const currentBlock = await provider.getBlockNumber();
    let totalEvents = 0;

    for (const pairAddress of lpAddresses) {
      const lastBlock = await getLastSyncedBlock(pairAddress);
      const startBlock = lastBlock > 0 ? lastBlock + 1 : currentBlock - 5000;

      if (startBlock > currentBlock) continue;

      for (let from = startBlock; from <= currentBlock; from += DEX_BATCH_SIZE) {
        const to = Math.min(from + DEX_BATCH_SIZE - 1, currentBlock);
        totalEvents += await processSwapEvents(pairAddress, from, to, vbcPrice);

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
const main = async (): Promise<void> => {
  await initDB();

  const args = process.argv.slice(2);
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
if (require.main === module) main();

process.on('SIGINT', () => {
  console.log('\n🛑 Stopped');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('\n🛑 Stopped');
  process.exit(0);
});
