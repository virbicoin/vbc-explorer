import type { Db } from 'mongodb';
import { apiCache, CACHE_TTL } from '@/lib/cache';
import type { AddressSummary, BlockSummary, TokenIdentity, TxSummary } from '@/lib/seo';

/**
 * Live-data lookups that enrich the entity pages' SEO snippets
 * (block / tx / address / token → generateMetadata).
 *
 * All of them run on the page's critical render path, so they share these
 * guarantees through `cachedDbLookup`:
 *
 * - **Never blocks.** `tryGetDb()` returns the handle only when a connection is
 *   already established and never initiates/awaits one, so a cold or down DB
 *   yields `null` and the caller falls back to param-only metadata.
 * - **Never throws.** Any error resolves to `null` (strictly additive).
 * - **Cached.** Positives and genuine "not found" are cached; a transient DB
 *   error is not (it rejects past the cache, so it's retried, not pinned).
 */

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

async function cachedDbLookup<T>(
  key: string,
  ttl: number,
  fn: (db: Db) => Promise<T | null>
): Promise<T | null> {
  try {
    // Lazy import keeps mongoose out of the module graph until enrichment runs.
    const { tryGetDb } = await import('@/lib/db/get-db');
    const db = tryGetDb();
    if (!db) return null; // connection not warm yet — retry next time, don't cache
    // fn may reject on a query error; getOrSet then rejects too and we fall back
    // below without caching the transient failure.
    return await apiCache.getOrSet<T | null>(key, () => fn(db), ttl);
  } catch {
    return null;
  }
}

/** Token display name/symbol/type — `tokens` registry first, then synced `Contract`. */
export async function getTokenSummary(address: string): Promise<TokenIdentity | null> {
  if (!ADDR_RE.test(address)) return null;
  return cachedDbLookup(`seo:token:${address.toLowerCase()}`, CACHE_TTL.VERY_LONG, async (db) => {
    const byAddress = { address: { $regex: new RegExp(`^${address}$`, 'i') } };

    const token = await db
      .collection('tokens')
      .findOne(byAddress, { projection: { name: 1, symbol: 1, type: 1 } });
    const fromToken = pickTokenIdentity(token?.name, token?.symbol, token?.type);
    if (fromToken) return fromToken;

    const contract = await db
      .collection('Contract')
      .findOne(byAddress, { projection: { tokenName: 1, symbol: 1 } });
    return pickTokenIdentity(contract?.tokenName, contract?.symbol);
  });
}

/** Block miner + timestamp (immutable once mined). `number` is unique-indexed. */
export async function getBlockSummary(blockNumber: string): Promise<BlockSummary | null> {
  if (!/^\d+$/.test(blockNumber)) return null;
  return cachedDbLookup(`seo:block:${blockNumber}`, CACHE_TTL.VERY_LONG, async (db) => {
    const doc = await db
      .collection('Block')
      .findOne({ number: Number(blockNumber) }, { projection: { miner: 1, timestamp: 1 } });
    if (!doc) return null;
    const miner = typeof doc.miner === 'string' ? doc.miner : undefined;
    const timestamp = typeof doc.timestamp === 'number' ? doc.timestamp : undefined;
    return miner || timestamp !== undefined ? { miner, timestamp } : null;
  });
}

/** Transaction from/to/value/status (immutable). `hash` is stored lowercase + indexed. */
export async function getTxSummary(hash: string): Promise<TxSummary | null> {
  if (!HASH_RE.test(hash)) return null;
  return cachedDbLookup(`seo:tx:${hash.toLowerCase()}`, CACHE_TTL.VERY_LONG, async (db) => {
    const doc = await db
      .collection('Transaction')
      .findOne(
        { hash: hash.toLowerCase() },
        { projection: { from: 1, to: 1, value: 1, status: 1 } }
      );
    if (!doc) return null;
    return {
      from: typeof doc.from === 'string' ? doc.from : undefined,
      to: typeof doc.to === 'string' ? doc.to : undefined,
      value: toWeiString(doc.value),
      status: typeof doc.status === 'number' ? doc.status : undefined,
    };
  });
}

/** Account balance + type. Balance changes, so a shorter TTL. `address` indexed (lowercase). */
export async function getAddressSummary(address: string): Promise<AddressSummary | null> {
  if (!ADDR_RE.test(address)) return null;
  return cachedDbLookup(`seo:addr:${address.toLowerCase()}`, CACHE_TTL.LONG, async (db) => {
    const doc = await db
      .collection('Account')
      .findOne({ address: address.toLowerCase() }, { projection: { balance: 1, type: 1 } });
    if (!doc) return null;
    const balance = toWeiString(doc.balance);
    const type = typeof doc.type === 'number' ? doc.type : undefined;
    return balance !== undefined || type !== undefined ? { balance, type } : null;
  });
}

/** Build a TokenIdentity from loosely-typed DB fields, or null when unusable. */
function pickTokenIdentity(name: unknown, symbol: unknown, type?: unknown): TokenIdentity | null {
  const n = typeof name === 'string' && name.trim() ? name.trim() : undefined;
  const s = typeof symbol === 'string' && symbol.trim() ? symbol.trim() : undefined;
  if (!n && !s) return null;
  const t = typeof type === 'string' && type.trim() ? type.trim() : undefined;
  return { name: n, symbol: s, type: t };
}

/** Normalize a wei field that may be stored as a string or (legacy) number. */
function toWeiString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value))
    return BigInt(Math.trunc(value)).toString();
  return undefined;
}
