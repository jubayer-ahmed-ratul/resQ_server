/**
 * Outbox Helper — Part 10
 *
 * Provides a single function to write an OutboxEvent inside an existing
 * Prisma transaction.  All business modules call this instead of writing
 * prisma.outboxEvent.create() directly, which keeps the outbox pattern
 * consistent across the codebase.
 *
 * Usage (inside a $transaction callback):
 *
 *   await writeOutboxEvent(tx, createEvent(EventType.INCIDENT_CREATED, {
 *     incidentId: incident.id,
 *     severity:   incident.severity,
 *     status:     incident.status,
 *     createdById: incident.createdById,
 *   }));
 *
 * The caller's transaction owns atomicity — if the outer transaction rolls
 * back, this INSERT is also rolled back, so no orphaned events are created.
 */

import { Prisma } from '@prisma/client';
import { DomainEvent } from '../event.interface';

type PrismaTx = Omit<
  Prisma.TransactionClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * writeOutboxEvent
 *
 * Inserts an OutboxEvent row inside the given Prisma transaction client.
 * Must be called inside a $transaction callback.
 */
export async function writeOutboxEvent(
  tx: PrismaTx,
  event: DomainEvent,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      eventId:   event.eventId,
      eventType: event.eventType,
      payload:   event.payload as Prisma.InputJsonValue,
      status:    'PENDING',
    },
  });
}

/**
 * writeOutboxEventDirect
 *
 * Inserts an OutboxEvent row using the top-level Prisma client (no tx).
 * Use this when there is no surrounding transaction available and you
 * still want the Outbox guarantee (e.g., the operation itself is a simple
 * read + immediate event).
 *
 * Prefer writeOutboxEvent (with tx) wherever possible.
 */
import prisma from '../../lib/prisma';

export async function writeOutboxEventDirect(event: DomainEvent): Promise<void> {
  await prisma.outboxEvent.create({
    data: {
      eventId:   event.eventId,
      eventType: event.eventType,
      payload:   event.payload as Prisma.InputJsonValue,
      status:    'PENDING',
    },
  });
}
