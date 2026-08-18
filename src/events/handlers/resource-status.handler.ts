/**
 * ResourceStatusHandler — Part 10
 *
 * Triggered when RESOURCE_STATUS_CHANGED arrives from the queue.
 *
 * Responsibility:
 *   Detect whether the status change indicates a resource failure that
 *   may require re-optimization of an active assignment.
 *
 *   If the resource moved to FAILED, MAINTENANCE, or UNAVAILABLE, AND
 *   the resource currently has an ACTIVE assignment, publish a
 *   REOPTIMIZATION_REQUESTED event (via outbox) so the reoptimization
 *   handler can take over.
 *
 *   This handler does NOT call the reoptimization service directly —
 *   it only emits the appropriate follow-up event.  This keeps each
 *   handler focused on a single concern and avoids long synchronous chains.
 */

import { Job } from 'bullmq';
import prisma from '../../lib/prisma';
import { DomainEvent, ResourceStatusChangedPayload } from '../event.interface';
import { EventType } from '../event.types';
import { createEvent } from '../event.publisher';
import { writeOutboxEventDirect } from '../outbox/outbox.helper';
import { ReoptimizationTrigger } from '../../modules/reoptimization/reoptimization.interface';

// Statuses that invalidate an existing assignment
const FAILURE_STATUSES = new Set(['FAILED', 'MAINTENANCE', 'UNAVAILABLE']);

// Map resource status → reoptimization trigger
const STATUS_TO_TRIGGER: Record<string, ReoptimizationTrigger> = {
  FAILED:      'RESOURCE_FAILURE',
  MAINTENANCE: 'RESOURCE_MAINTENANCE',
  UNAVAILABLE: 'RESOURCE_UNAVAILABLE',
};

export async function handleResourceStatusChanged(
  job: Job<unknown>,
): Promise<void> {
  const event = job.data as DomainEvent<ResourceStatusChangedPayload>;
  const { resourceId, resourceName, previousStatus, newStatus } = event.payload;

  console.log(
    `[ResourceStatusHandler] Resource "${resourceName}" (${resourceId}): ` +
    `${previousStatus} → ${newStatus}`,
  );

  if (!FAILURE_STATUSES.has(newStatus)) {
    // Status change is not a failure — nothing to do
    return;
  }

  // Check whether this resource has an ACTIVE assignment
  const activeAssignment = await prisma.assignment.findFirst({
    where: { resourceId, status: 'ACTIVE' },
    select: { id: true, incidentId: true },
  });

  if (!activeAssignment) {
    console.log(
      `[ResourceStatusHandler] Resource "${resourceName}" has no active assignment — ` +
      `no re-optimization needed.`,
    );
    return;
  }

  const trigger = STATUS_TO_TRIGGER[newStatus] ?? 'RESOURCE_UNAVAILABLE';

  console.log(
    `[ResourceStatusHandler] Resource "${resourceName}" is ${newStatus} ` +
    `and has active assignment ${activeAssignment.id} — requesting re-optimization.`,
  );

  const reoptEvent = createEvent(EventType.REOPTIMIZATION_REQUESTED, {
    incidentId:   activeAssignment.incidentId,
    assignmentId: activeAssignment.id,
    trigger,
  });

  await writeOutboxEventDirect(reoptEvent);
}
