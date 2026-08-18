/**
 * EventPublisher — Part 10
 *
 * Abstraction over the underlying queue technology.
 * Business modules depend on this interface, not on BullMQ directly.
 * This makes the queue implementation replaceable without touching domain code.
 *
 * The concrete implementation (BullMQEventPublisher) lives in
 * src/queue/queue.service.ts and is registered at startup.
 */

import { DomainEvent } from './event.interface';

// ─── Publisher interface ──────────────────────────────────────────────────────

export interface EventPublisher {
  /**
   * Publish a domain event to the queue.
   * Implementations must be non-blocking from the caller's perspective.
   */
  publish<T>(event: DomainEvent<T>): Promise<void>;

  /**
   * Gracefully close the publisher and its underlying connections.
   */
  close(): Promise<void>;
}

// ─── Singleton registry ───────────────────────────────────────────────────────
// Allows modules to get the publisher without importing BullMQ directly.

let _publisher: EventPublisher | null = null;

export function registerPublisher(publisher: EventPublisher): void {
  _publisher = publisher;
}

export function getPublisher(): EventPublisher {
  if (!_publisher) {
    throw new Error(
      '[EventPublisher] No publisher registered. ' +
      'Call registerPublisher() during application startup.',
    );
  }
  return _publisher;
}

// ─── Factory helper ───────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import { EventType } from './event.types';

/**
 * createEvent
 * Constructs a properly-enveloped DomainEvent with a fresh UUID and timestamp.
 */
export function createEvent<T>(
  eventType: EventType,
  payload: T,
  version = 1,
): DomainEvent<T> {
  return {
    eventId: randomUUID(),
    eventType,
    occurredAt: new Date().toISOString(),
    version,
    payload,
  };
}
