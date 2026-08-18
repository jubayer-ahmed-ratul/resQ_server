/**
 * Cache Service Implementation — Part 12
 *
 * Implements CacheService using ioredis directly (not via BullMQ).
 * Follows cache-aside pattern:
 *
 *   1. Check Redis (get)
 *   2. On HIT → return cached value
 *   3. On MISS → caller queries DB, then calls set()
 *
 * Fail-open design:
 *   All operations catch errors and return null/void so a Redis outage
 *   degrades gracefully to direct DB queries — it never crashes the API.
 *
 * Security:
 *   - Keys are constructed from CacheKeys constants only
 *   - User-supplied values are never used directly as cache keys
 *   - No secrets or credentials are cached
 *   - PostgreSQL remains authoritative for all business state
 */

import Redis from 'ioredis';
import config from '../config';
import logger from '../lib/logger';
import { CacheService } from './cache.interface';

// ─── Redis client factory ─────────────────────────────────────────────────────

function buildRedisClient(): Redis {
  const client = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    ...(config.redis.password ? { password: config.redis.password } : {}),
    // Upstash requires TLS — enable via REDIS_TLS=true
    ...(config.redis.tls ? { tls: {} } : {}),
    connectTimeout: config.redis.connectTimeout,
    // Do not block the process on connection errors
    lazyConnect: true,
    // Reasonable retry strategy: stop retrying after 3 failed attempts
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times > 3) return null; // stop retrying, caller gets error
      return Math.min(times * 200, 1000);
    },
    enableOfflineQueue: false,
  });

  client.on('error', (err: Error) => {
    // Log but don't crash — cache is best-effort
    logger.warn('[Cache] Redis error', {
      operation: 'cacheRedisError',
      message: err.message,
    });
  });

  client.on('connect', () => {
    logger.info('[Cache] Redis connected', { operation: 'cacheConnect' });
  });

  client.on('reconnecting', () => {
    logger.info('[Cache] Redis reconnecting', { operation: 'cacheReconnecting' });
  });

  return client;
}

// ─── RedisCacheService ────────────────────────────────────────────────────────

export class RedisCacheService implements CacheService {
  private readonly client: Redis;
  private _available = false;
  private readonly defaultTtl: number;

  constructor() {
    this.client = buildRedisClient();
    this.defaultTtl = config.cache.defaultTtlSeconds;

    this.client.on('connect', () => { this._available = true; });
    this.client.on('ready',   () => { this._available = true; });
    this.client.on('error',   () => { this._available = false; });
    this.client.on('close',   () => { this._available = false; });

    // Attempt connection asynchronously — API continues even if Redis is down
    this.client.connect().catch((err: Error) => {
      logger.warn('[Cache] Initial Redis connection failed — cache disabled', {
        operation: 'cacheInit',
        message: err.message,
      });
    });
  }

  isAvailable(): boolean {
    return this._available;
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this._available) return null;
    try {
      const raw = await this.client.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      logger.warn('[Cache] GET failed', {
        operation: 'cacheGet',
        key,
        message: (err as Error).message,
      });
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (!this._available) return;
    const ttl = ttlSeconds ?? this.defaultTtl;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (err) {
      logger.warn('[Cache] SET failed', {
        operation: 'cacheSet',
        key,
        ttl,
        message: (err as Error).message,
      });
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!this._available || keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch (err) {
      logger.warn('[Cache] DEL failed', {
        operation: 'cacheDel',
        keys,
        message: (err as Error).message,
      });
    }
  }

  async delPattern(pattern: string): Promise<void> {
    if (!this._available) return;
    try {
      // SCAN is preferred over KEYS in production (non-blocking)
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.client.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      logger.warn('[Cache] DELPATTERN failed', {
        operation: 'cacheDelPattern',
        pattern,
        message: (err as Error).message,
      });
    }
  }

  async close(): Promise<void> {
    await this.client.quit();
  }

  /** Direct Redis client access — for diagnostics / health checks only */
  getClient(): Redis {
    return this.client;
  }
}

// ─── NullCacheService ─────────────────────────────────────────────────────────
// Used when Redis is not configured. All operations are no-ops.

export class NullCacheService implements CacheService {
  isAvailable(): boolean { return false; }
  async get<T>(_key: string): Promise<T | null> { return null; }
  async set<T>(_key: string, _value: T, _ttl?: number): Promise<void> {}
  async del(..._keys: string[]): Promise<void> {}
  async delPattern(_pattern: string): Promise<void> {}
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _cacheService: CacheService | null = null;

export function getCacheService(): CacheService {
  if (!_cacheService) {
    // Only instantiate RedisCacheService if Redis is configured
    if (config.redis.host) {
      _cacheService = new RedisCacheService();
    } else {
      _cacheService = new NullCacheService();
      logger.warn('[Cache] No Redis host configured — cache disabled', {
        operation: 'cacheInit',
      });
    }
  }
  return _cacheService;
}
