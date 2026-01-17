/**
 * Price Service - Centralized price data access
 *
 * This service provides access to price data stored by tools/price.ts
 * Uses Market model data as primary source, with external APIs as fallback
 *
 * Priority order:
 * 1. Database (Market model - populated by tools/price.ts)
 * 2. CoinGecko
 * 3. CoinMarketCap (CMC)
 * 4. Coinpaprika
 * 5. Exbitron
 * 6. DEX (not implemented in this service - handled by tools/price.ts)
 */

import { Market } from '@/models/index';
import { loadConfig, getCurrencyConfig } from '@/lib/config';

export interface PriceData {
  symbol: string;
  priceUSD: number;
  priceBTC: number;
  timestamp: number;
  source: 'database' | 'coingecko' | 'cmc' | 'coinpaprika' | 'exbitron' | 'dex';
}

// In-memory cache for API routes (short-lived)
let priceCache: { data: PriceData; timestamp: number } | null = null;
const CACHE_TTL = 30000; // 30 seconds

/**
 * Get current price from Market database (populated by price.ts)
 */
export async function getPriceFromDatabase(): Promise<PriceData | null> {
  try {
    const latestPrice = await Market.findOne().sort({ timestamp: -1 }).lean();

    if (!latestPrice) {
      return null;
    }

    // Check if data is fresh (within 10 minutes)
    const age = Date.now() - latestPrice.timestamp;
    if (age > 10 * 60 * 1000) {
      console.log(`⚠️ Database price data is stale (${Math.round(age / 60000)} minutes old)`);
      return null;
    }

    return {
      symbol: latestPrice.symbol,
      priceUSD: latestPrice.quoteUSD,
      priceBTC: latestPrice.quoteBTC,
      timestamp: latestPrice.timestamp,
      source: 'database',
    };
  } catch (error) {
    console.error('Error fetching price from database:', error);
    return null;
  }
}

/**
 * Fetch price from CoinGecko API
 */
export async function getPriceFromCoinGecko(): Promise<PriceData | null> {
  const currencyConfig = getCurrencyConfig();
  if (!currencyConfig?.priceApi?.coingecko?.enabled) return null;

  try {
    const coinId = currencyConfig.priceApi.coingecko.id;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=btc,usd`,
      {
        signal: controller.signal,
        headers: { 'User-Agent': 'VBC-Explorer/1.0', Accept: 'application/json' },
      }
    );
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, { btc?: number; usd?: number }>;
    if (data[coinId] && data[coinId].usd && data[coinId].usd > 0) {
      return {
        symbol: currencyConfig.symbol,
        priceUSD: data[coinId].usd || 0,
        priceBTC: data[coinId].btc || 0,
        timestamp: Date.now(),
        source: 'coingecko',
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch price from CoinMarketCap API
 */
export async function getPriceFromCMC(): Promise<PriceData | null> {
  const currencyConfig = getCurrencyConfig();
  if (!currencyConfig?.priceApi?.cmc?.enabled) return null;

  try {
    const coinId = currencyConfig.priceApi.cmc.id;
    const apiKey = process.env.CMC_API_KEY;

    if (!apiKey) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(
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

    if (!response.ok) return null;

    const data = await response.json();
    const coinData = Object.values(data.data || {})[0] as {
      quote?: { USD?: { price?: number }; BTC?: { price?: number } };
    };

    if (coinData?.quote?.USD?.price && coinData.quote.USD.price > 0) {
      return {
        symbol: currencyConfig.symbol,
        priceUSD: coinData.quote.USD.price || 0,
        priceBTC: coinData.quote.BTC?.price || 0,
        timestamp: Date.now(),
        source: 'cmc',
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch price from Coinpaprika API
 */
export async function getPriceFromCoinpaprika(): Promise<PriceData | null> {
  const currencyConfig = getCurrencyConfig();
  if (!currencyConfig?.priceApi?.coinpaprika?.enabled) return null;

  try {
    const coinId = currencyConfig.priceApi.coinpaprika.id;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`https://api.coinpaprika.com/v1/tickers/${coinId}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'VBC-Explorer/1.0', Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = (await response.json()) as {
      quotes?: { USD?: { price?: number }; BTC?: { price?: number } };
    };

    if (data.quotes?.USD?.price && data.quotes.USD.price > 0) {
      return {
        symbol: currencyConfig.symbol,
        priceUSD: data.quotes.USD.price || 0,
        priceBTC: data.quotes.BTC?.price || 0,
        timestamp: Date.now(),
        source: 'coinpaprika',
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch price from Exbitron API
 */
export async function getPriceFromExbitron(symbol: string): Promise<PriceData | null> {
  const currencyConfig = getCurrencyConfig();
  // Check if explicitly disabled
  if (currencyConfig?.priceApi?.exbitron?.enabled === false) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch('https://api.exbitron.com/api/v1/cg/tickers', {
      signal: controller.signal,
      headers: { 'User-Agent': 'VBC-Explorer/1.0', Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const tickers = await response.json();
    const tickerSymbol = currencyConfig?.priceApi?.exbitron?.symbol || symbol;

    const usdtTicker = tickers.find(
      (t: { ticker_id: string }) => t.ticker_id === `${tickerSymbol}-USDT`
    );
    const btcTicker = tickers.find(
      (t: { ticker_id: string }) => t.ticker_id === `${tickerSymbol}-BTC`
    );

    if (usdtTicker?.last_price || btcTicker?.last_price) {
      const priceUSD = usdtTicker?.last_price ? parseFloat(usdtTicker.last_price) : 0;
      if (priceUSD > 0) {
        return {
          symbol,
          priceUSD,
          priceBTC: btcTicker?.last_price ? parseFloat(btcTicker.last_price) : 0,
          timestamp: Date.now(),
          source: 'exbitron',
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get current native token price
 * Priority: Database -> CoinGecko -> CMC -> Coinpaprika -> Exbitron
 */
export async function getNativePrice(): Promise<PriceData | null> {
  // Check memory cache first
  if (priceCache && Date.now() - priceCache.timestamp < CACHE_TTL) {
    return priceCache.data;
  }

  const config = loadConfig();
  const symbol = config.currency?.symbol || 'ETH';

  // 1. Try database first (data from price.ts)
  let price = await getPriceFromDatabase();

  // 2. Try CoinGecko
  if (!price) {
    price = await getPriceFromCoinGecko();
  }

  // 3. Try CoinMarketCap
  if (!price) {
    price = await getPriceFromCMC();
  }

  // 4. Try Coinpaprika
  if (!price) {
    price = await getPriceFromCoinpaprika();
  }

  // 5. Try Exbitron
  if (!price) {
    price = await getPriceFromExbitron(symbol);
  }

  if (price) {
    priceCache = { data: price, timestamp: Date.now() };
    return price;
  }

  return null;
}

/**
 * Get price with symbol override
 */
export async function getPrice(symbol?: string): Promise<PriceData | null> {
  const config = loadConfig();
  const targetSymbol = symbol || config.currency?.symbol || 'ETH';

  // For native token, use standard flow
  if (targetSymbol === config.currency?.symbol) {
    return getNativePrice();
  }

  // For other tokens, try Exbitron only
  return getPriceFromExbitron(targetSymbol);
}

/**
 * Clear price cache (useful for testing)
 */
export function clearPriceCache(): void {
  priceCache = null;
}
