/**
 * Event Worker — Part 10
 *
 * BullMQ Worker that consumes jobs from the "domain-events" queue.
 *
 * Architecture:
 *   - Each job carries a DomainEvent envelope.
 *   - The worker routes to the appropriate handler by eventType.
 *   - Before processing, it checks ProcessedEvent for idempotency.
 *   - After processing, it records the eventId in ProcessedEvent.
 *   - BullMQ handles retries with exponential backoff (configured on the Queue).
 *   - Permanent failures (invalid payload, unsupported type) are not retried —
 *     they throw a non-retriable error so BullMQ moves them to failed state.
 *
 * Idempotency guarantee:
 *   If the same eventId arrives twice (duplicate delivery), the second job
 *   finds the ProcessedEvent record and skips processing without error.
 *   This is safe because duplicate delivery is expected in at-least-once
 *   queue semantics.
 *
 * Retry policy:
 *   Transient errors (DB connection, temporary unavailability) are retried
 *   up to WORKER_MAX_ATTEMPTS with exponential backoff (1s → 2s → 4s).
 *   The attempts and backoff are configured in BullMQQueueService.
 */

import { Worker, Job, UnrecoverableError } from 'bullmq';
import prisma from '../lib/prisma';
import logger from '../lib/logger';
import config from '../config';
import { buildRedisConnection, DOMAIN_EVENTS_QUEUE } from '../queue/queue.service';
import { DomainEvent } from '../events/event.interface';
import { EventType } from '../events/event.types';
import { handleIncidentCreated } from '../events/handlers/incident-created.handler';
import { handlePriorityCalculated } from '../events/handlers/priority-calculated.handler';
import { handleResourceStatusChanged } from '../events/handlers/resource-status.handler';
import { handleAssignmentEvent } from '../events/handlers/assignment.handler';
import { handleReoptimizationRequested } from '../events/handlers/reoptimization.handler';

// ─── Idempotency check ────────────────────────────────────────────────────────

async function isAlreadyProcessed(eventId: string): Promise<boolean> {
  const existing = await prisma.processedEvent.findUnique({
    where: { eventId },
    select: { id: true },
  });
  return existing !== null;
}

async function markProcessed(eventId: string, eventType: string): Promise<void> {
  // upsert protects against the rare case where two worker instances
  // race to mark the same event (e.g. on a re-queued job that completed
  // but the ack was lost).
  await prisma.processedEvent.upsert({
    where:  { eventId },
    update: {},
    create: { eventId, eventType },
  });
}

// ─── Payload validation ───────────────────────────────────────────────────────

function validateEnvelope(data: unknown): DomainEvent {
  if (
    !data ||
    typeof data !== 'object' ||
    !('eventId' in data) ||
    !('eventType' in data) ||
    !('payload' in data)
  ) {
    // Permanent failure — malformed envelope; no point retrying
    throw new UnrecoverableError('Invalid event envelope: missing required fields.');
  }
  return data as DomainEvent;
}

// ─── Job processor ────────────────────────────────────────────────────────────

async function processJob(job: Job): Promise<void> {
  const startedAt = Date.now();
  const event = validateEnvelope(job.data);
  const { eventId, eventType } = event;

  // Idempotency: skip if already processed
  if (await isAlreadyProcessed(eventId)) {
    logger.info('[EventWorker] Duplicate event skipped', {
      operation: 'processJob',
      eventId,
      eventType,
      jobId: job.id,
    });
    return;
  }

  logger.info('[EventWorker] Processing event', {
    operation: 'processJob',
    eventId,
    eventType,
    jobId: job.id,
    attempt: job.attemptsMade + 1,
  });

  // Route to handler
  switch (eventType) {
    case EventType.INCIDENT_CREATED:
      await handleIncidentCreated(job);
      break;

    case EventType.PRIORITY_CALCULATED:
      await handlePriorityCalculated(job);
      break;

    case EventType.RESOURCE_STATUS_CHANGED:
    case EventType.RESOURCE_FAILURE_DETECTED:
      await handleResourceStatusChanged(job);
      break;

    case EventType.ASSIGNMENT_CREATED:
    case EventType.ASSIGNMENT_COMPLETED:
    case EventType.ASSIGNMENT_CANCELLED:
      await handleAssignmentEvent(job);
      break;

    case EventType.REOPTIMIZATION_REQUESTED:
      await handleReoptimizationRequested(job);
      break;

    case EventType.INCIDENT_UPDATED:
    case EventType.REOPTIMIZATION_COMPLETED:
      console.log(`[EventWorker] Event acknowledged (no handler): ${eventType}`);
      break;

    default:
      throw new UnrecoverableError(`Unsupported event type: ${eventType}`);
  }

  // Mark processed AFTER successful handler execution
  // (not before — ensures we don't skip an event whose handler failed)
  await markProcessed(eventId, eventType);

  const durationMs = Date.now() - startedAt;
  logger.info('[EventWorker] Event completed', {
    operation: 'processJob',
    eventId,
    eventType,
    jobId: job.id,
    durationMs,
  });
}

// ─── Worker factory ───────────────────────────────────────────────────────────

export function createEventWorker(): Worker {
  const concurrency = config.workerConcurrency;
  logger.info('[EventWorker] Starting with concurrency', {
    operation: 'createEventWorker',
    concurrency,
  });

  const worker = new Worker(
    DOMAIN_EVENTS_QUEUE,
    processJob,
    {
      connection: buildRedisConnection(),
      // Concurrency configurable via WORKER_CONCURRENCY env var (default: 5).
      // Higher concurrency = more parallelism but more DB connections consumed.
      // Rule of thumb: WORKER_CONCURRENCY × (API instances) must stay within
      // PostgreSQL max_connections / 2 to leave headroom for API queries.
      concurrency,
    },
  );

  worker.on('completed', (job) => {
    logger.info('[EventWorker] Job completed', { operation: 'jobCompleted', jobId: job.id, jobName: job.name });
  });

  worker.on('failed', (job, err) => {
    logger.error('[EventWorker] Job failed', {
      operation: 'jobFailed',
      jobId: job?.id,
      jobName: job?.name,
      attempt: job?.attemptsMade,
      errorCode: 'INTERNAL_ERROR',
      message: err.message,
    });
  });

  worker.on('error', (err) => {
    logger.error('[EventWorker] Worker error', {
      operation: 'workerError',
      errorCode: 'INTERNAL_ERROR',
      message: err.message,
    });
  });

  return worker;
}
