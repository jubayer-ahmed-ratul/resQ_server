/**
 * API Server Entry Point — Unified (API + Worker)
 *
 * Single-process mode for free hosting (Render free tier).
 * Runs API server + BullMQ worker + Outbox publisher + Cleanup scheduler
 * all in one process.
 *
 * For separate worker process (production scaling), use:
 *   npm run start        → API only
 *   npm run start:worker → Worker only
 */

import { validateConfig } from './config';
validateConfig();

import config from './config';
import logger from './lib/logger';
import app from './app';
import prisma from './lib/prisma';
import { getQueueService } from './queue/queue.service';
import { getCacheService } from './cache/cache.service';
import { createEventWorker } from './workers/event.worker';
import { startOutboxPublisher } from './events/outbox/outbox.publisher';
import { startCleanupScheduler } from './lib/cleanup';
import { Worker } from 'bullmq';

const PORT = config.port;

// ─── Start background services ────────────────────────────────────────────────

const queueService = getQueueService();

// Start BullMQ worker (processes domain events)
let eventWorker: Worker;
let stopOutbox: () => void;
let stopCleanup: () => void;

try {
  eventWorker = createEventWorker();
  stopOutbox  = startOutboxPublisher(config.worker.outboxPollIntervalMs);
  stopCleanup = startCleanupScheduler(config.cleanupIntervalMs);

  logger.info('[Server] Background services started', {
    operation: 'serverStart',
    workerConcurrency: config.workerConcurrency,
    outboxPollIntervalMs: config.worker.outboxPollIntervalMs,
  });
} catch (err) {
  logger.error('[Server] Failed to start background services', {
    operation: 'serverStart',
    message: (err as Error).message,
  });
  // Continue anyway — API still works, events will queue in Outbox
}

// ─── Start HTTP server ────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  logger.info('[Server] Emergency Response API started', {
    operation: 'serverStart',
    port: PORT,
    nodeEnv: config.nodeEnv,
    mode: 'unified (API + Worker)',
    healthUrl: `http://localhost:${PORT}/health`,
    readyUrl:  `http://localhost:${PORT}/ready`,
    redis: `${config.redis.host}:${config.redis.port}`,
  });
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`[Server] Port ${PORT} is already in use.`, {
      operation: 'serverStart',
      errorCode: 'INTERNAL_ERROR',
    });
  } else {
    logger.error('[Server] Startup error', {
      operation: 'serverStart',
      errorCode: 'INTERNAL_ERROR',
      message: error.message,
    });
  }
  process.exit(1);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info(`[Server] Received ${signal} — shutting down gracefully...`, {
    operation: 'serverShutdown',
    signal,
  });

  const forceExit = setTimeout(() => {
    logger.error(
      `[Server] Graceful shutdown exceeded ${config.shutdownTimeoutMs}ms — forcing exit.`,
      { operation: 'serverShutdown', errorCode: 'SHUTDOWN_TIMEOUT' },
    );
    process.exit(1);
  }, config.shutdownTimeoutMs);
  if (forceExit.unref) forceExit.unref();

  // 1. Stop HTTP server (no new requests)
  server.close(async () => {
    logger.info('[Server] HTTP server closed.', { operation: 'serverShutdown' });

    // 2. Stop BullMQ worker
    try {
      if (eventWorker) {
        await eventWorker.close();
        logger.info('[Server] Event worker closed.', { operation: 'serverShutdown' });
      }
    } catch (err) {
      logger.error('[Server] Error closing worker', { operation: 'serverShutdown', message: (err as Error).message });
    }

    // 3. Stop outbox + cleanup schedulers
    if (stopOutbox)  stopOutbox();
    if (stopCleanup) stopCleanup();

    // 4. Close queue connection
    try {
      await queueService.close();
      logger.info('[Server] Queue closed.', { operation: 'serverShutdown' });
    } catch (err) {
      logger.error('[Server] Error closing queue', { operation: 'serverShutdown', message: (err as Error).message });
    }

    // 5. Close cache connection
    try {
      const cacheService = getCacheService();
      if ('close' in cacheService && typeof (cacheService as { close: () => Promise<void> }).close === 'function') {
        await (cacheService as { close: () => Promise<void> }).close();
      }
      logger.info('[Server] Cache closed.', { operation: 'serverShutdown' });
    } catch (err) {
      logger.error('[Server] Error closing cache', { operation: 'serverShutdown', message: (err as Error).message });
    }

    // 6. Disconnect Prisma
    try {
      await prisma.$disconnect();
      logger.info('[Server] Prisma disconnected.', { operation: 'serverShutdown' });
    } catch (err) {
      logger.error('[Server] Error disconnecting Prisma', { operation: 'serverShutdown', message: (err as Error).message });
    }

    logger.info('[Server] Shutdown complete.', { operation: 'serverShutdown' });
    clearTimeout(forceExit);
    process.exit(0);
  });
}

process.on('SIGINT',  () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
