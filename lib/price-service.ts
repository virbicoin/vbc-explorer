/**
 * Price Service - Centralized price data access
 *
 * This service provides access to price data stored by tools/price.ts
 * Uses Market model data as primary source, with Exbitron API as fallback
 */

import { Market } from '@/models/index';
import { loadConfig } from '@/lib/config';

export interface PriceData {
  symbol: string;
  priceUSD: number;
  priceBTC: number;
  timestamp: number;
  source: 'database' | 'exbitron' | 'dex';
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
 * Fetch price from Exbitron API (fallback)
 */
export async function getPriceFromExbitron(symbol: string): Promise<PriceData | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch('https://api.exbitron.com/api/v1/cg/tickers', {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const tickers = await response.json();

    const usdtTicker = tickers.find((t: { ticker_id: string }) => t.ticker_id === `${symbol}-USDT`);
    const btcTicker = tickers.find((t: { ticker_id: string }) => t.ticker_id === `${symbol}-BTC`);

    if (usdtTicker?.last_price || btcTicker?.last_price) {
      return {
        symbol,
        priceUSD: usdtTicker?.last_price ? parseFloat(usdtTicker.last_price) : 0,
        priceBTC: btcTicker?.last_price ? parseFloat(btcTicker.last_price) : 0,
        timestamp: Date.now(),
        source: 'exbitron',
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching price from Exbitron:', error);
    return null;
  }
}

/**
 * Get current native token price
 * Priority: Database (Market) -> Exbitron API
 */
export async function getNativePrice(): Promise<PriceData | null> {
  // Check memory cache first
  if (priceCache && Date.now() - priceCache.timestamp < CACHE_TTL) {
    return priceCache.data;
  }

  const config = loadConfig();
  const symbol = config.currency?.symbol || 'ETH';

  // Try database first (data from price.ts)
  const dbPrice = await getPriceFromDatabase();
  if (dbPrice) {
    priceCache = { data: dbPrice, timestamp: Date.now() };
    return dbPrice;
  }

  // Fallback to Exbitron API
  const exbitronPrice = await getPriceFromExbitron(symbol);
  if (exbitronPrice) {
    priceCache = { data: exbitronPrice, timestamp: Date.now() };
    return exbitronPrice;
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
