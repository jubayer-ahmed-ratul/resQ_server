/**
 * Event Interfaces — Part 10
 *
 * Every domain event shares a common envelope (DomainEvent<T>).
 * Strongly-typed payload interfaces prevent accidental field omissions.
 *
 * Envelope fields:
 *   eventId     — UUID v4; used as idempotency key by workers
 *   eventType   — from EventType registry
 *   occurredAt  — ISO-8601 timestamp when the business fact occurred
 *   version     — schema version; increment when payload shape changes
 *   payload     — event-specific data (no secrets, no full DB objects)
 */

import { EventType } from './event.types';

// ─── Common envelope ─────────────────────────────────────────────────────────

export interface DomainEvent<T = unknown> {
  eventId: string;
  eventType: EventType;
  occurredAt: string;   // ISO-8601
  version: number;
  payload: T;
}

// ─── Payload interfaces ───────────────────────────────────────────────────────

export interface IncidentCreatedPayload {
  incidentId: string;
  severity: string;
  status: string;
  createdById: string;
}

export interface IncidentUpdatedPayload {
  incidentId: string;
  updatedFields: string[];
}

export interface PriorityCalculatedPayload {
  incidentId: string;
  priorityScore: number;
  decisionLogId?: string;
}

export interface ResourceStatusChangedPayload {
  resourceId: string;
  resourceName: string;
  previousStatus: string;
  newStatus: string;
}

export interface ResourceFailureDetectedPayload {
  resourceId: string;
  resourceName: string;
  // The active assignment that may need re-optimization, if any
  activeAssignmentId?: string;
}

export interface AssignmentCreatedPayload {
  assignmentId: string;
  incidentId: string;
  resourceId: string;
}

export interface AssignmentCompletedPayload {
  assignmentId: string;
  incidentId: string;
  resourceId: string;
}

export interface AssignmentCancelledPayload {
  assignmentId: string;
  incidentId: string;
  resourceId: string;
}

export interface ReoptimizationRequestedPayload {
  incidentId: string;
  assignmentId: string;
  trigger: string;
  accessCondition?: string;
}

export interface ReoptimizationCompletedPayload {
  incidentId: string;
  assignmentId: string;
  reoptimized: boolean;
  newAssignmentId?: string;
  trigger: string;
}

// ─── Typed event aliases ──────────────────────────────────────────────────────

export type IncidentCreatedEvent        = DomainEvent<IncidentCreatedPayload>;
export type IncidentUpdatedEvent        = DomainEvent<IncidentUpdatedPayload>;
export type PriorityCalculatedEvent     = DomainEvent<PriorityCalculatedPayload>;
export type ResourceStatusChangedEvent  = DomainEvent<ResourceStatusChangedPayload>;
export type ResourceFailureDetectedEvent = DomainEvent<ResourceFailureDetectedPayload>;
export type AssignmentCreatedEvent      = DomainEvent<AssignmentCreatedPayload>;
export type AssignmentCompletedEvent    = DomainEvent<AssignmentCompletedPayload>;
export type AssignmentCancelledEvent    = DomainEvent<AssignmentCancelledPayload>;
export type ReoptimizationRequestedEvent = DomainEvent<ReoptimizationRequestedPayload>;
export type ReoptimizationCompletedEvent = DomainEvent<ReoptimizationCompletedPayload>;
