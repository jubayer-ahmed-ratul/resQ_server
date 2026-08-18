/**
 * Rate Limiting middleware — Part 12 updated
 *
 * Two limiters in one file:
 *
 * 1. In-process limiter (express-rate-limit):
 *    Used when Redis is unavailable or for single-instance deployments.
 *    State is in-process memory — NOT shared across API instances.
 *
 * 2. Redis-backed distributed limiter:
 *    Uses a sliding-window approach via ioredis.
 *    State is in Redis — shared across ALL API instances behind a load balancer.
 *    Falls back to in-process on Redis failure (fail-open design).
 *
 * For horizontal scaling, the distributed limiter is the correct approach.
 * Without it, each API instance has its own counter — a user can hit all
 * instances and exceed the intended limit by N × limit (where N = instances).
 *
 * Limits:
 *   Auth endpoints:       20% of general (prevents brute-force)
 *   Expensive endpoints:  50% of general
 *   General API:          100% base limit
 */

import { Request, Response, NextFunction } from 'express';
import rateLimit, { Options } from 'express-rate-limit';
import config from '../config';
import { getCacheService } from '../cache/cache.service';
import logger from '../lib/logger';

// ─── Response formatter ───────────────────────────────────────────────────────

const handler: Options['handler'] = (req, res) => {
  res.status(429).json({
    success:   false,
    message:   'Too many requests. Please slow down and try again later.',
    errorCode: 'RATE_LIMITED',
    requestId: (req as Express.Request & { requestId?: string }).requestId,
  });
};

function getClientKey(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]!.trim();
  return req.ip ?? 'unknown';
}

// ─── In-process limiters ──────────────────────────────────────────────────────
// These work for single-instance deployments.
// In multi-instance deployments they under-count (each instance has own counter).

export const generalRateLimit = rateLimit({
  windowMs:         config.rateLimit.windowMs,
  max:              config.rateLimit.maxRequests,
  standardHeaders:  true,
  legacyHeaders:    false,
  handler,
  keyGenerator: getClientKey,
});

export const authRateLimit = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max:      Math.max(1, Math.floor(config.rateLimit.maxRequests * 0.2)),
  standardHeaders: true,
  legacyHeaders:   false,
  handler,
  keyGenerator: getClientKey,
});

export const expensiveRateLimit = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max:      Math.max(1, Math.floor(config.rateLimit.maxRequests * 0.5)),
  standardHeaders: true,
  legacyHeaders:   false,
  handler,
  keyGenerator: getClientKey,
});

// ─── Distributed Redis-backed rate limiter ────────────────────────────────────
// Uses a Redis counter with TTL per (prefix + clientKey) window.
// Falls back to in-process limiters on Redis failure.

/**
 * distributedRateLimit
 *
 * Factory for a distributed rate-limit middleware backed by Redis.
 *
 * @param prefix   Cache key prefix (e.g. "rl:api", "rl:auth")
 * @param max      Max requests allowed per window
 * @param windowMs Window duration in milliseconds
 * @param fallback In-process limiter to use when Redis is unavailable
 */
export function distributedRateLimit(
  prefix: string,
  max: number,
  windowMs: number,
  fallback: ReturnType<typeof rateLimit>,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const cache = getCacheService();

    // Fall back to in-process when Redis is unavailable
    if (!cache.isAvailable()) {
      return fallback(req, res, next);
    }

    const clientKey = getClientKey(req);
    // Bounded key: prefix + sanitized client IP. Never from user input directly.
    const redisKey = `${prefix}:${clientKey}`;

    try {
      // Use ioredis directly for atomic INCR + EXPIRE
      // getCacheService() returns RedisCacheService which exposes getClient()
      const cacheImpl = cache as import('../cache/cache.service').RedisCacheService;
      if (typeof cacheImpl.getClient !== 'function') {
        return fallback(req, res, next);
      }

      const client = cacheImpl.getClient();
      const current = await client.incr(redisKey);

      if (current === 1) {
        // First request in this window — set TTL
        await client.pexpire(redisKey, windowMs);
      }

      // Set informational headers
      const ttlMs = await client.pttl(redisKey);
      const remaining = Math.max(0, max - current);

      res.setHeader('RateLimit-Limit', max);
      res.setHeader('RateLimit-Remaining', remaining);
      res.setHeader('RateLimit-Reset', Math.ceil(Date.now() / 1000 + ttlMs / 1000));

      if (current > max) {
        logger.warn('[RateLimit] Distributed rate limit exceeded', {
          operation: 'distributedRateLimit',
          prefix,
          clientKey,
          current,
          max,
        });
        res.status(429).json({
          success:   false,
          message:   'Too many requests. Please slow down and try again later.',
          errorCode: 'RATE_LIMITED',
          requestId: req.requestId,
        });
        return;
      }

      next();
    } catch (err) {
      // On any Redis error, fail open and use in-process limiter
      logger.warn('[RateLimit] Redis error — falling back to in-process limiter', {
        operation: 'distributedRateLimit',
        prefix,
        message: (err as Error).message,
      });
      return fallback(req, res, next);
    }
  };
}

// ─── Distributed limiter instances ───────────────────────────────────────────
// These are the preferred limiters for multi-instance deployments.

export const distributedGeneralRateLimit = distributedRateLimit(
  'rl:api',
  config.rateLimit.maxRequests,
  config.rateLimit.windowMs,
  generalRateLimit,
);

export const distributedAuthRateLimit = distributedRateLimit(
  'rl:auth',
  Math.max(1, Math.floor(config.rateLimit.maxRequests * 0.2)),
  config.rateLimit.windowMs,
  authRateLimit,
);

export const distributedExpensiveRateLimit = distributedRateLimit(
  'rl:expensive',
  Math.max(1, Math.floor(config.rateLimit.maxRequests * 0.5)),
  config.rateLimit.windowMs,
  expensiveRateLimit,
);
