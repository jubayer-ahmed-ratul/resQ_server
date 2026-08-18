export type AssignmentStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

// ─── Status transition map ────────────────────────────────────────────────────
//
// Allowed transitions:
//   PENDING   → ACTIVE     (resource deployment confirmed)
//   ACTIVE    → COMPLETED  (mission accomplished)
//   ACTIVE    → CANCELLED  (mission aborted)
//   PENDING   → CANCELLED  (assignment voided before activation)
//
// COMPLETED and CANCELLED are terminal — no further transitions.

export const ALLOWED_ASSIGNMENT_TRANSITIONS: Record<
  AssignmentStatus,
  AssignmentStatus[]
> = {
  PENDING: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

// ─── Request shapes ───────────────────────────────────────────────────────────

export interface CreateAssignmentInput {
  incidentId: string;
  resourceId: string;
}

export interface AssignmentFilters {
  incidentId?: string;
  resourceId?: string;
  status?: AssignmentStatus;
}

// ─── Error codes ──────────────────────────────────────────────────────────────

export const ASSIGNMENT_ERRORS = {
  RESOURCE_NOT_AVAILABLE: 'Resource is not available for assignment.',
  RESOURCE_ALREADY_ASSIGNED: 'Resource already has an active assignment.',
  INCIDENT_ALREADY_ASSIGNED: 'Incident already has an active assignment.',
  INCIDENT_NOT_ELIGIBLE: 'Incident is not in an eligible status for assignment.',
  INVALID_ASSIGNMENT_STATE: 'Assignment cannot transition from its current state.',
  RESOURCE_TYPE_MISMATCH: 'Resource type does not match incident requirements.',
  RESOURCE_CAPACITY_INSUFFICIENT: 'Resource capacity is insufficient for the number of affected people.',
} as const;
