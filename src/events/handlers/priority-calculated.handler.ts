/**
 * PriorityCalculatedHandler — Part 10
 *
 * Triggered when PRIORITY_CALCULATED arrives from the queue.
 *
 * Responsibility:
 *   Currently logs the event for audit/observability.
 *   Future consumers (notification system, operational dashboard) can
 *   be added here without changing the publisher or worker routing.
 *
 * This handler is intentionally lightweight — Part 10 scope does not
 * include notifications or dashboards.
 */

import { Job } from 'bullmq';
import { DomainEvent, PriorityCalculatedPayload } from '../event.interface';
import logger from '../../lib/logger';

export async function handlePriorityCalculated(
  job: Job<unknown>,
): Promise<void> {
  const event = job.data as DomainEvent<PriorityCalculatedPayload>;
  const { incidentId, priorityScore } = event.payload;

  logger.info(
    `[PriorityCalculatedHandler] Incident ${incidentId} — priority score: ${priorityScore}`,
    {
      operation: 'handlePriorityCalculated',
      incidentId,
      priorityScore,
      jobId: job.id,
    },
  );

  // Future: notify coordinators, update dashboard, trigger analytics pipeline.
}