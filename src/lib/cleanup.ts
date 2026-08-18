/**
 * Cleanup Jobs — Part 11
 *
 * Scheduled cleanup for tables that grow indefinitely without pruning.
 *
 * Tables cleaned:
 *   IdempotencyKey  — rows past their expiresAt TTL
 *   ProcessedEvent  — rows older than PROCESSED_EVENT_RETENTION_DAYS (default 7d)
 *
 * These jobs run in the worker process on a configurable interval.
 * They are intentionally lightweight — delete only expired rows, small batches.
 */

import prisma from './prisma';
import logger from './logger';
import config from '../config';

// How long to retain ProcessedEvent records (milliseconds)
const PROCESSED_EVENT_RETENTION_MS =
  (config.processedEventRetentionDays ?? 7) * 24 * 60 * 60 * 1000;

// ─── Idempotency key pruning ──────────────────────────────────────────────────

export async function pruneExpiredIdempotencyKeys(): Promise<number> {
  try {
    const result = await prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      logger.info('[Cleanup] Pruned expired idempotency keys', {
        operation: 'pruneIdempotencyKeys',
        count: result.count,
      });
    }
    return result.count;
  } catch (err) {
    logger.error('[Cleanup] Failed to prune idempotency keys', {
      operation: 'pruneIdempotencyKeys',
      errorCode: 'DATABASE_ERROR',
      message: (err as Error).message,
    });
    return 0;
  }
}

// ─── ProcessedEvent pruning ───────────────────────────────────────────────────

export async function pruneOldProcessedEvents(): Promise<number> {
  const cutoff = new Date(Date.now() - PROCESSED_EVENT_RETENTION_MS);
  try {
    const result = await prisma.processedEvent.deleteMany({
      where: { processedAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      logger.info('[Cleanup] Pruned old processed events', {
        operation: 'pruneProcessedEvents',
        count: result.count,
        retentionDays: config.processedEventRetentionDays ?? 7,
      });
    }
    return result.count;
  } catch (err) {
    logger.error('[Cleanup] Failed to prune processed events', {
      operation: 'pruneProcessedEvents',
      errorCode: 'DATABASE_ERROR',
      message: (err as Error).message,
    });
    return 0;
  }
}

// ─── Start cleanup scheduler ──────────────────────────────────────────────────

/**
 * startCleanupScheduler
 *
 * Runs both prune jobs on a single interval.
 * Returns a stop function to cancel the interval on shutdown.
 *
 * Default interval: every 6 hours (21_600_000 ms).
 * Override via CLEANUP_INTERVAL_MS env var.
 */
export function startCleanupScheduler(
  intervalMs = config.cleanupIntervalMs ?? 6 * 60 * 60 * 1000,
): () => void {
  logger.info('[Cleanup] Scheduler started', {
    operation: 'startCleanupScheduler',
    intervalMs,
  });

  // Run once at startup (don't wait 6h for first clean)
  void pruneExpiredIdempotencyKeys();
  void pruneOldProcessedEvents();

  const timer = setInterval(async () => {
    await pruneExpiredIdempotencyKeys();
    await pruneOldProcessedEvents();
  }, intervalMs);

  return () => {
    clearInterval(timer);
    logger.info('[Cleanup] Scheduler stopped', { operation: 'startCleanupScheduler' });
  };
}
