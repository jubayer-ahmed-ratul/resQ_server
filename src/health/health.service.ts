/**
 * Health Service — Part 11
 *
 * Liveness: "Is the process alive?" — always returns ok if the process runs.
 * Readiness: "Can the service safely receive traffic?" — checks DB + Redis.
 *
 * Liveness vs Readiness distinction:
 *   A temporary DB outage makes the service not READY (stop sending traffic)
 *   but the process is still LIVE (don't restart it).
 *   Restarting on a DB outage would be counterproductive.
 *
 * Redis check: pings the BullMQ queue connection. If Redis is down,
 *   background processing pauses (OutboxEvents accumulate) but the API
 *   can continue serving reads and writes — so Redis failure degrades
 *   readiness but the API is still partially functional.
 *   We mark Redis as "degraded" rather than a hard failure.
 */

import prisma from '../lib/prisma';
import { getQueueService } from '../queue/queue.service';
import { getCacheService } from '../cache/cache.service';
import config from '../config';

// ─── Result types ─────────────────────────────────────────────────────────────

export type DependencyStatus = 'up' | 'down' | 'degraded';

export interface DependencyCheck {
  status: DependencyStatus;
  latencyMs?: number;
  error?: string;
}

export interface ReadinessResult {
  status: 'ready' | 'not_ready' | 'degraded';
  dependencies: {
    database: DependencyCheck;
    redis: DependencyCheck;
    cache: DependencyCheck;
  };
}

export interface LivenessResult {
  status: 'ok';
  service: string;
  version: string;
  uptime: number;
}

// ─── Liveness check ───────────────────────────────────────────────────────────

export function getLivenessStatus(): LivenessResult {
  return {
    status:  'ok',
    service: 'emergency-response-api',
    version: '1.0.0',
    uptime:  Math.floor(process.uptime()),
  };
}

// ─── Database check ───────────────────────────────────────────────────────────

async function checkDatabase(): Promise<DependencyCheck> {
  const start = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('DB ping timeout')),
          config.database.connectionTimeout,
        ),
      ),
    ]);
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status:    'down',
      latencyMs: Date.now() - start,
      error:     (err as Error).message,
    };
  }
}

// ─── Redis check ─────────────────────────────────────────────────────────────

async function checkRedis(): Promise<DependencyCheck> {
  const start = Date.now();
  try {
    const queue = getQueueService();
    // BullMQ Queue exposes its Redis client; run a lightweight ping
    const client = await (queue as unknown as { queue: { client: Promise<{ ping: () => Promise<unknown> }> } }).queue.client;
    await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Redis ping timeout')),
          config.redis.connectTimeout,
        ),
      ),
    ]);
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (err) {
    // Redis failure is "degraded" not "down" from the API's perspective
    return {
      status:    'degraded',
      latencyMs: Date.now() - start,
      error:     (err as Error).message,
    };
  }
}

// ─── Cache check ──────────────────────────────────────────────────────────────

async function checkCache(): Promise<DependencyCheck> {
  const cache = getCacheService();
  if (!cache.isAvailable()) {
    return { status: 'degraded', error: 'Cache not available' };
  }
  const start = Date.now();
  try {
    // Simple round-trip test
    await cache.set('health:ping', 1, 10);
    const result = await cache.get<number>('health:ping');
    if (result !== 1) throw new Error('Cache ping returned unexpected value');
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: 'degraded',
      latencyMs: Date.now() - start,
      error: (err as Error).message,
    };
  }
}

// ─── Readiness check ─────────────────────────────────────────────────────────

export async function getReadinessStatus(): Promise<ReadinessResult> {
  const [database, redis, cache] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkCache(),
  ]);

  // Database is critical — if it's down, the service is not ready
  // Redis/cache are non-critical for reads/writes — degraded but not not_ready
  let status: ReadinessResult['status'] = 'ready';
  if (database.status === 'down') {
    status = 'not_ready';
  } else if (redis.status === 'degraded' || cache.status === 'degraded') {
    status = 'degraded';
  }

  return {
    status,
    dependencies: { database, redis, cache },
  };
}
