import { createModuleLogger } from './logger';

const logger = createModuleLogger('cache', 'LOG_LEVEL_CACHE');

/**
 * LRU (Least Recently Used) Cache implementation
 *
 * Maintains a maximum size by evicting least recently used entries.
 * Used to prevent unbounded memory growth in caches.
 */
export class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number) {
    if (maxSize < 1) {
      throw new Error('LRU cache maxSize must be at least 1');
    }
    this.maxSize = maxSize;

    logger.info('LRU cache initialized', {
      maxSize
    });
  }

  /**
   * Get a value from the cache
   * Moves accessed item to end (most recently used)
   */
  get(key: K): V | undefined {
    const hit = this.cache.has(key);

    // Trace logging (very verbose - enable only for cache debugging)
    // logger.trace('Cache access', { hit, currentSize: this.cache.size });

    if (!hit) {
      this.misses++;
      return undefined;
    }

    // Move to end (most recently used)
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);

    this.hits++;
    return value;
  }

  /**
   * Set a value in the cache
   * Evicts least recently used item if at capacity
   */
  set(key: K, value: V): void {
    // If key exists, delete it first (will be re-added at end)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Delete least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey === undefined) {
        return;
      }

      logger.debug('Cache eviction', {
        evicted_key: String(firstKey).substring(0, 50), // Truncate for safety
        size: this.cache.size,
        maxSize: this.maxSize,
        utilization_percent: ((this.cache.size / this.maxSize) * 100).toFixed(1)
      });

      this.cache.delete(firstKey);
    }

    this.cache.set(key, value);
  }

  /**
   * Check if key exists in cache
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete a key from cache
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get current cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    hitRate: number;
    utilizationPercent: number;
  } {
    const total = this.hits + this.misses;
    const stats = {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      utilizationPercent: (this.cache.size / this.maxSize) * 100
    };

    if (stats.hitRate < 0.5 && this.hits + this.misses > 100) {
      logger.warn('Low cache hit rate detected', {
        hit_rate: stats.hitRate.toFixed(3),
        hits: stats.hits,
        misses: stats.misses,
        size: stats.size
      });
    }

    return stats;
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get all keys (ordered from least to most recently used)
   */
  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  /**
   * Get all values (ordered from least to most recently used)
   */
  values(): IterableIterator<V> {
    return this.cache.values();
  }

  /**
   * Get all entries (ordered from least to most recently used)
   */
  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }
}
