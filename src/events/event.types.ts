/**
 * Event Types — Part 10
 *
 * Central registry of all domain event type strings.
 * Using a const object (rather than an enum) keeps the values as plain
 * strings in JSON, which is friendlier for queue payloads and logs.
 */

export const EventType = {
  // Incident lifecycle
  INCIDENT_CREATED:          'INCIDENT_CREATED',
  INCIDENT_UPDATED:          'INCIDENT_UPDATED',
  PRIORITY_CALCULATED:       'PRIORITY_CALCULATED',

  // Resource lifecycle
  RESOURCE_STATUS_CHANGED:   'RESOURCE_STATUS_CHANGED',
  RESOURCE_FAILURE_DETECTED: 'RESOURCE_FAILURE_DETECTED',

  // Assignment lifecycle
  ASSIGNMENT_CREATED:        'ASSIGNMENT_CREATED',
  ASSIGNMENT_COMPLETED:      'ASSIGNMENT_COMPLETED',
  ASSIGNMENT_CANCELLED:      'ASSIGNMENT_CANCELLED',

  // Re-optimization lifecycle
  REOPTIMIZATION_REQUESTED:  'REOPTIMIZATION_REQUESTED',
  REOPTIMIZATION_COMPLETED:  'REOPTIMIZATION_COMPLETED',
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];
