/**
 * In-Memory Cache with TTL
 * 
 * Simple LRU-like cache for API responses and expensive computations.
 * Reduces database queries and blockchain RPC calls.
 */

interface CacheEntry<T> {
  value: T;
  expires: number;
  size: number;
}

interface CacheOptions {
  maxSize?: number;      // Max entries (default: 1000)
  defaultTTL?: number;   // Default TTL in ms (default: 60s)
  maxMemoryMB?: number;  // Max memory in MB (default: 50)
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private maxSize: number;
  private defaultTTL: number;
  private maxMemoryBytes: number;
  private currentSize = 0;
  private hits = 0;
  private misses = 0;

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize || 1000;
    this.defaultTTL = options.defaultTTL || 60 * 1000; // 60 seconds
    this.maxMemoryBytes = (options.maxMemoryMB || 50) * 1024 * 1024;
  }

  /**
   * Get cached value
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    
    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() > entry.expires) {
      this.delete(key);
      this.misses++;
      return undefined;
    }

    this.hits++;
    return entry.value;
  }

  /**
   * Set cached value with optional TTL
   */
  set<T>(key: string, value: T, ttl?: number): void {
    const expires = Date.now() + (ttl || this.defaultTTL);
    const size = this.estimateSize(value);

    // Evict if needed
    while (
      (this.cache.size >= this.maxSize || this.currentSize + size > this.maxMemoryBytes) &&
      this.cache.size > 0
    ) {
      this.evictOldest();
    }

    // Remove old entry if exists
    if (this.cache.has(key)) {
      this.delete(key);
    }

    this.cache.set(key, { value, expires, size });
    this.currentSize += size;
  }

  /**
   * Delete cached value
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentSize -= entry.size;
      return this.cache.delete(key);
    }
    return false;
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expires) {
      this.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    this.currentSize = 0;
  }

  /**
   * Get or set pattern - fetch if not cached
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await fetcher();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    memoryMB: number;
    hitRate: number;
    hits: number;
    misses: number;
  } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      memoryMB: Math.round(this.currentSize / 1024 / 1024 * 100) / 100,
      hitRate: total > 0 ? Math.round(this.hits / total * 100) / 100 : 0,
      hits: this.hits,
      misses: this.misses,
    };
  }

  /**
   * Cleanup expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expires) {
        this.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  private evictOldest(): void {
    const firstKey = this.cache.keys().next().value;
    if (firstKey) {
      this.delete(firstKey);
    }
  }

  private estimateSize(value: unknown): number {
    // Rough estimation of object size in bytes
    const str = JSON.stringify(value);
    return str ? str.length * 2 : 100; // UTF-16 chars = 2 bytes each
  }
}

// Cache TTL constants (in milliseconds)
export const CACHE_TTL = {
  SHORT: 10 * 1000,        // 10 seconds - for rapidly changing data
  MEDIUM: 60 * 1000,       // 1 minute - for moderately changing data
  LONG: 5 * 60 * 1000,     // 5 minutes - for stable data
  VERY_LONG: 30 * 60 * 1000, // 30 minutes - for rarely changing data
} as const;

// Global cache instances
export const apiCache = new MemoryCache({
  maxSize: 500,
  defaultTTL: CACHE_TTL.MEDIUM,
  maxMemoryMB: 30,
});

export const dbCache = new MemoryCache({
  maxSize: 200,
  defaultTTL: CACHE_TTL.SHORT,
  maxMemoryMB: 20,
});

// Periodic cleanup (every 5 minutes)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    apiCache.cleanup();
    dbCache.cleanup();
  }, 5 * 60 * 1000);
}

export { MemoryCache };
