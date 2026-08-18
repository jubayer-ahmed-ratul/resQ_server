/**
 * ReoptimizationHandler — Part 10
 *
 * Triggered when REOPTIMIZATION_REQUESTED arrives from the queue.
 *
 * Responsibility:
 *   Call the Part 9 reoptimization service with the event payload.
 *   Publish a REOPTIMIZATION_COMPLETED outbox event with the result.
 *
 * This handler does NOT duplicate any reoptimization logic — it only
 * bridges the event queue to the existing reoptimizeAssignment() service.
 * This is exactly the worker-ready design built into Part 9.
 */

import { Job } from 'bullmq';
import { DomainEvent, ReoptimizationRequestedPayload } from '../event.interface';
import { reoptimizeAssignment } from '../../modules/reoptimization/reoptimization.service';
import { ReoptimizationTrigger, AccessCondition } from '../../modules/reoptimization/reoptimization.interface';
import { EventType } from '../event.types';
import { createEvent } from '../event.publisher';
import { writeOutboxEventDirect } from '../outbox/outbox.helper';

export async function handleReoptimizationRequested(
  job: Job<unknown>,
): Promise<void> {
  const event = job.data as DomainEvent<ReoptimizationRequestedPayload>;
  const { incidentId, assignmentId, trigger, accessCondition } = event.payload;

  console.log(
    `[ReoptimizationHandler] Processing REOPTIMIZATION_REQUESTED — ` +
    `assignment ${assignmentId}, trigger: ${trigger}`,
  );

  const result = await reoptimizeAssignment({
    assignmentId,
    trigger: trigger as ReoptimizationTrigger,
    accessCondition: accessCondition as AccessCondition | undefined,
  });

  // Publish REOPTIMIZATION_COMPLETED event via outbox
  const completedEvent = createEvent(EventType.REOPTIMIZATION_COMPLETED, {
    incidentId,
    assignmentId,
    reoptimized:     result.reoptimized,
    newAssignmentId: result.newAssignmentId ?? undefined,
    trigger,
  });
  await writeOutboxEventDirect(completedEvent);

  console.log(
    `[ReoptimizationHandler] Completed — reoptimized: ${result.reoptimized}, ` +
    `message: ${result.message}`,
  );
}
