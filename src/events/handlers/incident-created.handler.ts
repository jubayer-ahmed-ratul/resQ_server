/**
 * IncidentCreatedHandler — Part 10
 *
 * Triggered when INCIDENT_CREATED arrives from the queue.
 *
 * Responsibility:
 *   Trigger priority calculation for the new incident.
 *   Reuses Part 5 (calculateAndSaveIncidentPriority) without duplication.
 *
 * After priority is calculated, the decision service automatically creates
 * a DecisionLog (Part 8). A PRIORITY_CALCULATED outbox event is then
 * written so downstream consumers can react asynchronously.
 */

import { Job } from 'bullmq';
import { DomainEvent, IncidentCreatedPayload } from '../event.interface';
import { calculateAndSaveIncidentPriority } from '../../modules/decision/decision.service';
import { EventType } from '../event.types';
import { createEvent } from '../event.publisher';
import { writeOutboxEventDirect } from '../outbox/outbox.helper';

export async function handleIncidentCreated(
  job: Job<unknown>,
): Promise<void> {
  const event = job.data as DomainEvent<IncidentCreatedPayload>;
  const { incidentId } = event.payload;

  console.log(`[IncidentCreatedHandler] Calculating priority for incident ${incidentId}`);

  const result = await calculateAndSaveIncidentPriority(incidentId);

  // Publish PRIORITY_CALCULATED event via outbox
  const priorityEvent = createEvent(EventType.PRIORITY_CALCULATED, {
    incidentId,
    priorityScore: result.priorityScore,
  });
  await writeOutboxEventDirect(priorityEvent);

  console.log(
    `[IncidentCreatedHandler] Priority ${result.priorityScore} calculated for incident ${incidentId}`,
  );
}
