/**
 * Cache Interface — Part 12
 *
 * Abstraction over the underlying cache implementation.
 * Business services depend on this interface, not on ioredis directly.
 *
 * Design:
 *   - Cache-aside pattern: check cache → on miss query DB → store in cache
 *   - TTL is configurable per call, with a default from config
 *   - Keys are namespaced (e.g. "resource:list", "hospital:{id}")
 *   - Redis is the implementation; null object used when Redis is unavailable
 */

export interface CacheService {
  /**
   * Get a cached value by key.
   * Returns null on miss or error (fail-open design).
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set a cached value with optional TTL in seconds.
   * Silently fails on error — cache is best-effort.
   */
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;

  /**
   * Delete one or more cached keys (for cache invalidation).
   * Silently fails on error.
   */
  del(...keys: string[]): Promise<void>;

  /**
   * Delete all keys matching a glob pattern.
   * Use cautiously — only with bounded patterns, never from user input.
   */
  delPattern(pattern: string): Promise<void>;

  /**
   * Check if cache is available (for diagnostics).
   */
  isAvailable(): boolean;
}

// ─── Cache key namespace constants ───────────────────────────────────────────
// Using constants prevents typos and makes invalidation explicit.

export const CacheKeys = {
  RESOURCE_LIST: 'resource:list',
  RESOURCE_LIST_QUERY: (key: string) => `resource:list:${key}`,
  RESOURCE_BY_ID: (id: string) => `resource:${id}`,
  HOSPITAL_LIST: 'hospital:list',
  HOSPITAL_LIST_QUERY: (key: string) => `hospital:list:${key}`,
  HOSPITAL_BY_ID: (id: string) => `hospital:${id}`,
  HOSPITAL_AVAILABILITY: (id: string) => `hospital:${id}:availability`,
} as const;
