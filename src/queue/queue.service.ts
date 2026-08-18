/**
 * BullMQ Queue Service — Part 10
 *
 * Concrete implementation of EventQueue and EventPublisher using BullMQ + Redis.
 *
 * Architecture:
 *   - One BullMQ Queue ("domain-events") receives all event types.
 *   - The Worker (src/workers/event.worker.ts) reads from this queue.
 *   - The Queue and Worker share the same Redis connection config.
 *   - The API process only ever enqueues — it never processes jobs.
 *
 * Backoff strategy:
 *   Exponential: 1s → 2s → 4s (for WORKER_MAX_ATTEMPTS = 3).
 *   BullMQ handles the scheduling; no manual timers needed.
 *
 * Graceful shutdown:
 *   Call close() before process exit. BullMQ drains in-flight jobs.
 */

import { Queue, ConnectionOptions } from 'bullmq';
import config from '../config';
import { DomainEvent } from '../events/event.interface';
import { EventQueue } from './queue.interface';
import { EventPublisher, registerPublisher } from '../events/event.publisher';

// ─── Queue name ───────────────────────────────────────────────────────────────

export const DOMAIN_EVENTS_QUEUE = 'domain-events';

// ─── Redis connection options ─────────────────────────────────────────────────

export function buildRedisConnection(): ConnectionOptions {
  return {
    host: config.redis.host,
    port: config.redis.port,
    ...(config.redis.password ? { password: config.redis.password } : {}),
    // BullMQ recommendation: disable auto-reconnect on the client used by Queue
    // (the Worker manages its own connection).
    maxRetriesPerRequest: null,
  };
}

// ─── BullMQ Queue Service ─────────────────────────────────────────────────────

export class BullMQQueueService implements EventQueue, EventPublisher {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue(DOMAIN_EVENTS_QUEUE, {
      connection: buildRedisConnection(),
      defaultJobOptions: {
        attempts: config.worker.maxAttempts,
        backoff: {
          type: 'exponential',
          delay: 1000, // 1s base; doubles each retry
        },
        // Remove completed jobs after 24 h to keep Redis memory bounded.
        removeOnComplete: { age: 86400 },
        // Keep failed jobs for 7 days for debugging.
        removeOnFail: { age: 604800 },
      },
    });
  }

  /**
   * enqueue — adds a domain event as a BullMQ job.
   * Job name = eventType for easy filtering in BullMQ board.
   * Job ID  = eventId for idempotent enqueueing (BullMQ deduplicates by jobId).
   */
  async enqueue(event: DomainEvent): Promise<void> {
    await this.queue.add(event.eventType, event, {
      jobId: event.eventId, // deduplication key
    });
  }

  /** EventPublisher.publish — delegates to enqueue */
  async publish<T>(event: DomainEvent<T>): Promise<void> {
    await this.enqueue(event as DomainEvent);
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

let _queueService: BullMQQueueService | null = null;

/**
 * getQueueService — returns (and lazily creates) the singleton BullMQ service.
 * Called once at API startup and once at worker startup.
 */
export function getQueueService(): BullMQQueueService {
  if (!_queueService) {
    _queueService = new BullMQQueueService();
    registerPublisher(_queueService);
  }
  return _queueService;
}
