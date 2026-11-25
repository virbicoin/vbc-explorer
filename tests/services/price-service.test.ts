/**
 * lib/price-service.ts: the price read from the Market collection keeps the
 * origin tools/price.ts stored with it, and the label reported by the API
 * names that origin. mongodb-memory-server.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Market } from '@/models/index';
import { getPriceFromDatabase, priceSourceLabel, type PriceData } from '@/lib/price-service';

let mongod: MongoMemoryServer;

const MINUTE = 60_000;
const price = (overrides: Partial<PriceData>): PriceData => ({
  symbol: 'VBC',
  priceUSD: 0.0008,
  priceBTC: 0,
  timestamp: Date.now(),
  source: 'database',
  ...overrides,
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('explorerDB_price'), { autoIndex: false });
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
  vi.restoreAllMocks();
});

describe('priceSourceLabel', () => {
  it('names the source of a price fetched directly', () => {
    expect(priceSourceLabel(price({ source: 'dex' }))).toBe('DEX');
    expect(priceSourceLabel(price({ source: 'coingecko' }))).toBe('CoinGecko');
    expect(priceSourceLabel(price({ source: 'wikaex' }))).toBe('WikaEx');
  });

  it('names the origin stored with a database row', () => {
    expect(priceSourceLabel(price({ origin: 'dex' }))).toBe('DEX');
    expect(priceSourceLabel(price({ origin: 'cmc' }))).toBe('CoinMarketCap');
  });

  it('reports a database row without origin as Market DB', () => {
    expect(priceSourceLabel(price({}))).toBe('Market DB');
  });

  it('does not name a source when there is no price', () => {
    expect(priceSourceLabel(null)).toBe('unavailable');
  });
});

describe('getPriceFromDatabase', () => {
  it('returns the latest row with its origin', async () => {
    const now = Date.now();
    await Market.create([
      { symbol: 'VBC', timestamp: now - 6 * MINUTE, quoteUSD: 0.0007, quoteBTC: 0, source: 'dex' },
      { symbol: 'VBC', timestamp: now - MINUTE, quoteUSD: 0.0008, quoteBTC: 0, source: 'dex' },
    ]);
    expect(await getPriceFromDatabase()).toEqual({
      symbol: 'VBC',
      priceUSD: 0.0008,
      priceBTC: 0,
      timestamp: now - MINUTE,
      source: 'database',
      origin: 'dex',
    });
  });

  it('leaves the origin out for a row written before it was stored', async () => {
    await Market.create({ symbol: 'VBC', timestamp: Date.now(), quoteUSD: 0.0008, quoteBTC: 0 });
    const latest = await getPriceFromDatabase();
    expect(latest?.origin).toBeUndefined();
    expect(priceSourceLabel(latest)).toBe('Market DB');
  });

  it('ignores an origin it does not know', async () => {
    await Market.create({
      symbol: 'VBC',
      timestamp: Date.now(),
      quoteUSD: 0.0008,
      quoteBTC: 0,
      source: 'constructor',
    });
    expect((await getPriceFromDatabase())?.origin).toBeUndefined();
  });

  it('returns null when the latest row is older than ten minutes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await Market.create({
      symbol: 'VBC',
      timestamp: Date.now() - 11 * MINUTE,
      quoteUSD: 0.0008,
      quoteBTC: 0,
      source: 'dex',
    });
    expect(await getPriceFromDatabase()).toBeNull();
  });

  it('returns null without any row', async () => {
    expect(await getPriceFromDatabase()).toBeNull();
  });
});
