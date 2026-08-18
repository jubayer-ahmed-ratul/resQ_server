/**
 * Queue Interface — Part 10
 *
 * Decouples business code from the concrete queue technology (BullMQ/Redis).
 * Any queue implementation must satisfy this contract.
 */

import { DomainEvent } from '../events/event.interface';

export interface EventQueue {
  /**
   * Add a domain event to the queue for async processing.
   */
  enqueue(event: DomainEvent): Promise<void>;

  /**
   * Gracefully drain and close the queue connection.
   */
  close(): Promise<void>;
}
