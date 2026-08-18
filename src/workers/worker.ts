/**
 * Worker Entry Point — Part 11 updated
 *
 * Run with:   npm run worker
 *
 * This process runs SEPARATELY from the API server.
 * It:
 *   1. Initialises the BullMQ queue service (Redis connection).
 *   2. Starts the Outbox Publisher polling loop.
 *   3. Starts the Event Worker (consumes jobs from the queue).
 *   4. Starts the Cleanup Scheduler (prunes expired IdempotencyKeys + old ProcessedEvents).
 *   5. Handles SIGINT / SIGTERM for graceful shutdown.
 *
 * The API server (src/index.ts) only enqueues via the Outbox.
 * The worker process is responsible for publishing and consuming.
 *
 * Separation of concerns:
 *   API process   → handles HTTP, writes OutboxEvents to DB
 *   Worker process → publishes OutboxEvents, processes queue jobs, runs cleanup
 */

import prisma from '../lib/prisma';
import { validateConfig } from '../config';

validateConfig();

import config from '../config';
import logger from '../lib/logger';
import { getQueueService } from '../queue/queue.service';
import { startOutboxPublisher } from '../events/outbox/outbox.publisher';
import { createEventWorker } from './event.worker';
import { startCleanupScheduler } from '../lib/cleanup';

async function startWorker(): Promise<void> {
  logger.info('[Worker] Starting Emergency Response Worker...', {
    operation: 'workerStart',
    nodeEnv: config.nodeEnv,
    redisHost: config.redis.host,
    redisPort: config.redis.port,
    maxAttempts: config.worker.maxAttempts,
    outboxPollIntervalMs: config.worker.outboxPollIntervalMs,
    cleanupIntervalMs: config.cleanupIntervalMs,
  });

  // Initialise queue service (also registers publisher singleton)
  const queueService = getQueueService();

  // Start outbox publisher polling loop
  const stopOutbox = startOutboxPublisher(config.worker.outboxPollIntervalMs);

  // Start BullMQ worker
  const worker = createEventWorker();

  // Start cleanup scheduler — prunes expired idempotency keys + old processed events
  const stopCleanup = startCleanupScheduler(config.cleanupIntervalMs);

  logger.info('[Worker] Ready — listening for events.', { operation: 'workerStart' });

  // ─── Graceful shutdown ──────────────────────────────────────────────────────

  async function shutdown(signal: string): Promise<void> {
    logger.info(`[Worker] Received ${signal} — shutting down gracefully...`, {
      operation: 'workerShutdown',
      signal,
    });

    const forceExit = setTimeout(() => {
      logger.error(
        `[Worker] Graceful shutdown exceeded ${config.shutdownTimeoutMs}ms — forcing exit.`,
        { operation: 'workerShutdown', errorCode: 'SHUTDOWN_TIMEOUT' },
      );
      process.exit(1);
    }, config.shutdownTimeoutMs);
    if (forceExit.unref) forceExit.unref();

    // 1. Stop accepting new jobs
    await worker.close();
    logger.info('[Worker] BullMQ worker closed.', { operation: 'workerShutdown' });

    // 2. Stop outbox polling
    stopOutbox();

    // 3. Stop cleanup scheduler
    stopCleanup();

    // 4. Close queue/Redis connection
    await queueService.close();
    logger.info('[Worker] Queue connection closed.', { operation: 'workerShutdown' });

    // 5. Disconnect Prisma
    await prisma.$disconnect();
    logger.info('[Worker] Prisma disconnected.', { operation: 'workerShutdown' });

    logger.info('[Worker] Shutdown complete.', { operation: 'workerShutdown' });
    clearTimeout(forceExit);
    process.exit(0);
  }

  process.on('SIGINT',  () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

startWorker().catch((err: Error) => {
  logger.error('[Worker] Fatal startup error', {
    operation: 'workerStart',
    errorCode: 'INTERNAL_ERROR',
    message: err.message,
  });
  process.exit(1);
});
