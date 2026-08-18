/**
 * Outbox Publisher — Part 11 updated
 *
 * Changes from Part 10:
 *   - Uses withRetry() for queue enqueue calls to handle transient Redis failures.
 *   - Uses structured logger instead of console.*.
 *   - On Redis failure: event stays PENDING in DB (Outbox guarantee preserved).
 */

import prisma from '../../lib/prisma';
import logger from '../../lib/logger';
import { getQueueService } from '../../queue/queue.service';
import { DomainEvent } from '../event.interface';
import { withRetry, isTransientError } from '../../reliability/retry';

const MAX_PUBLISH_ATTEMPTS = 5;
// Batch size per poll cycle — prevents memory spikes on large backlogs
const BATCH_SIZE = 50;

/**
 * publishPendingOutboxEvents
 *
 * Called on each poll tick. Fetches the oldest PENDING outbox events
 * (up to BATCH_SIZE) and attempts to publish each to the queue.
 *
 * Returns the number of successfully published events.
 */
export async function publishPendingOutboxEvents(): Promise<number> {
  const pending = await prisma.outboxEvent.findMany({
    where: { status: 'PENDING', attempts: { lt: MAX_PUBLISH_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
  });

  if (pending.length === 0) return 0;

  const queue = getQueueService();
  let published = 0;

  for (const outboxEvent of pending) {
    try {
      const domainEvent: DomainEvent = {
        eventId:    outboxEvent.eventId,
        eventType:  outboxEvent.eventType as DomainEvent['eventType'],
        occurredAt: outboxEvent.createdAt.toISOString(),
        version:    1,
        payload:    outboxEvent.payload as Record<string, unknown>,
      };

      // Retry transient Redis/queue failures — event stays PENDING if all retries fail
      await withRetry(
        () => queue.enqueue(domainEvent),
        {
          operationName: `enqueueEvent:${outboxEvent.eventType}`,
          shouldRetry: (err) => isTransientError(err),
        },
      );

      await prisma.outboxEvent.update({
        where: { id: outboxEvent.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });

      published++;
    } catch (err) {
      const nextAttempts = outboxEvent.attempts + 1;
      await prisma.outboxEvent.update({
        where: { id: outboxEvent.id },
        data: {
          attempts: nextAttempts,
          status: nextAttempts >= MAX_PUBLISH_ATTEMPTS ? 'FAILED' : 'PENDING',
        },
      });

      logger.error('[OutboxPublisher] Failed to publish event', {
        operation: 'publishPendingOutboxEvents',
        eventId: outboxEvent.eventId,
        eventType: outboxEvent.eventType,
        attempt: nextAttempts,
        errorCode: 'DEPENDENCY_UNAVAILABLE',
        message: (err as Error).message,
      });
    }
  }

  return published;
}

/**
 * startOutboxPublisher
 *
 * Starts a polling loop on the given interval (ms).
 * Returns a stop function that cancels the interval.
 *
 * Called once from the worker entry point (src/workers/worker.ts).
 * Never called from the API server.
 */
export function startOutboxPublisher(intervalMs: number): () => void {
  logger.info(`[OutboxPublisher] Starting`, {
    operation: 'outboxPublisherStart',
    intervalMs,
  });

  const timer = setInterval(async () => {
    try {
      const count = await publishPendingOutboxEvents();
      if (count > 0) {
        logger.info(`[OutboxPublisher] Published pending outbox events`, {
          operation: 'outboxPublisherPoll',
          count,
        });
      }
    } catch (err) {
      logger.error('[OutboxPublisher] Unexpected error during poll', {
        operation: 'outboxPublisherPoll',
        errorCode: 'INTERNAL_ERROR',
        message: (err as Error).message,
      });
    }
  }, intervalMs);

  return () => {
    clearInterval(timer);
    logger.info('[OutboxPublisher] Stopped.', { operation: 'outboxPublisherStop' });
  };
}
