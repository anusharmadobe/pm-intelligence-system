/**
 * In-memory LRU cache for API key validation
 *
 * Caches validated API keys to avoid database queries on every request.
 * Uses TTL to ensure keys are periodically revalidated.
 */

import { ApiKey } from '../services/api_key_service';
import { logger } from './logger';

interface CacheEntry {
  apiKey: ApiKey;
  cachedAt: number;
}

export class ApiKeyCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(options: { ttlMs?: number; maxSize?: number } = {}) {
    this.ttlMs = options.ttlMs || 5 * 60 * 1000; // 5 minutes default
    this.maxSize = options.maxSize || 1000; // Max 1000 cached keys
  }

  /**
   * Get cached API key if valid
   */
  get(keyHash: string): ApiKey | null {
    const entry = this.cache.get(keyHash);

    if (!entry) {
      return null;
    }

    // Check if TTL expired
    const age = Date.now() - entry.cachedAt;
    if (age > this.ttlMs) {
      this.cache.delete(keyHash);
      logger.debug('API key cache entry expired', {
        key_prefix: entry.apiKey.key_prefix,
        age_ms: age,
        ttl_ms: this.ttlMs
      });
      return null;
    }

    logger.debug('API key cache hit', {
      key_prefix: entry.apiKey.key_prefix,
      age_ms: age
    });

    return entry.apiKey;
  }

  /**
   * Set cached API key
   */
  set(keyHash: string, apiKey: ApiKey): void {
    // Enforce max size with LRU eviction
    if (this.cache.size >= this.maxSize && !this.cache.has(keyHash)) {
      // Remove oldest entry (first in iteration order)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
        logger.debug('API key cache evicted oldest entry', {
          cache_size: this.cache.size,
          max_size: this.maxSize
        });
      }
    }

    this.cache.set(keyHash, {
      apiKey,
      cachedAt: Date.now()
    });

    logger.debug('API key cached', {
      key_prefix: apiKey.key_prefix,
      cache_size: this.cache.size
    });
  }

  /**
   * Invalidate cached entry
   */
  invalidate(keyHash: string): void {
    const deleted = this.cache.delete(keyHash);
    if (deleted) {
      logger.info('API key cache invalidated', {
        cache_size: this.cache.size
      });
    }
  }

  /**
   * Invalidate all cached entries for an API key ID
   * Used when key is revoked or updated
   */
  invalidateById(apiKeyId: string): void {
    let invalidated = 0;
    for (const [hash, entry] of this.cache.entries()) {
      if (entry.apiKey.id === apiKeyId) {
        this.cache.delete(hash);
        invalidated++;
      }
    }

    if (invalidated > 0) {
      logger.info('API key cache invalidated by ID', {
        api_key_id: apiKeyId,
        invalidated_count: invalidated,
        cache_size: this.cache.size
      });
    }
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    logger.info('API key cache cleared', {
      cleared_count: size
    });
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    ttlMs: number;
    entries: Array<{ keyPrefix: string; ageMs: number }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.cache.values()).map((entry) => ({
      keyPrefix: entry.apiKey.key_prefix,
      ageMs: now - entry.cachedAt
    }));

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      entries
    };
  }
}

// Export singleton instance
export const apiKeyCache = new ApiKeyCache({
  ttlMs: parseInt(process.env.API_KEY_CACHE_TTL_MS || '300000', 10), // 5 min default
  maxSize: parseInt(process.env.API_KEY_CACHE_MAX_SIZE || '1000', 10)
});
