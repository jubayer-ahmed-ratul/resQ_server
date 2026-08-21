/**
 * AssignmentHandler — Part 10
 *
 * Handles ASSIGNMENT_CREATED, ASSIGNMENT_COMPLETED, ASSIGNMENT_CANCELLED.
 *
 * Responsibility:
 *   Currently logs each lifecycle event for audit/observability.
 *   Future extensions (notifications, dashboards, analytics) can be
 *   added here without touching the publisher or worker routing.
 */

import { Job } from 'bullmq';
import {
  DomainEvent,
  AssignmentCreatedPayload,
  AssignmentCompletedPayload,
  AssignmentCancelledPayload,
} from '../event.interface';
import { EventType } from '../event.types';
import logger from '../../lib/logger';

export async function handleAssignmentCreated(
  job: Job<unknown>,
): Promise<void> {
  const event = job.data as DomainEvent<AssignmentCreatedPayload>;
  const { assignmentId, incidentId, resourceId } = event.payload;
  logger.info(
    `[AssignmentHandler] CREATED — assignment ${assignmentId} (incident: ${incidentId}, resource: ${resourceId})`,
    {
      operation: 'handleAssignmentCreated',
      assignmentId,
      incidentId,
      resourceId,
      jobId: job.id,
    },
  );
}

export async function handleAssignmentCompleted(
  job: Job<unknown>,
): Promise<void> {
  const event = job.data as DomainEvent<AssignmentCompletedPayload>;
  const { assignmentId, incidentId, resourceId } = event.payload;
  logger.info(
    `[AssignmentHandler] COMPLETED — assignment ${assignmentId} (incident: ${incidentId}, resource: ${resourceId})`,
    {
      operation: 'handleAssignmentCompleted',
      assignmentId,
      incidentId,
      resourceId,
      jobId: job.id,
    },
  );
}

export async function handleAssignmentCancelled(
  job: Job<unknown>,
): Promise<void> {
  const event = job.data as DomainEvent<AssignmentCancelledPayload>;
  const { assignmentId, incidentId, resourceId } = event.payload;
  logger.info(
    `[AssignmentHandler] CANCELLED — assignment ${assignmentId} (incident: ${incidentId}, resource: ${resourceId})`,
    {
      operation: 'handleAssignmentCancelled',
      assignmentId,
      incidentId,
      resourceId,
      jobId: job.id,
    },
  );
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function handleAssignmentEvent(
  job: Job<unknown>,
): Promise<void> {
  const event = job.data as DomainEvent;
  switch (event.eventType) {
    case EventType.ASSIGNMENT_CREATED:
      return handleAssignmentCreated(job);
    case EventType.ASSIGNMENT_COMPLETED:
      return handleAssignmentCompleted(job);
    case EventType.ASSIGNMENT_CANCELLED:
      return handleAssignmentCancelled(job);
    default:
      logger.warn(`[AssignmentHandler] Unhandled event type: ${event.eventType}`, {
        operation: 'handleAssignmentEvent',
        eventType: event.eventType,
        jobId: job.id,
      });
  }
}