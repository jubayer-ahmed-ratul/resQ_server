// ─── Enums (mirrors Prisma enums — avoids importing generated client in interfaces) ──

export type IncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type IncidentStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';
export type TimeSensitivity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// ─── Status transition map ────────────────────────────────────────────────────

/**
 * Allowed forward transitions for operational status changes.
 *
 * PENDING     → APPROVED    (by COORDINATOR/ADMIN via /approve)
 * PENDING     → REJECTED    (by COORDINATOR/ADMIN via /reject)
 * APPROVED    → ASSIGNED    (by COORDINATOR/ADMIN when resource assigned)
 * ASSIGNED    → IN_PROGRESS (by OPERATOR/COORDINATOR when task starts)
 * IN_PROGRESS → COMPLETED   (by OPERATOR/COORDINATOR when task done)
 * any active  → CANCELLED
 *
 * OPERATOR/ADMIN-created incidents start as APPROVED automatically.
 * REJECTED incidents cannot be transitioned further.
 */
export const ALLOWED_STATUS_TRANSITIONS: Record<
  IncidentStatus,
  IncidentStatus[]
> = {
  PENDING:     ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED:    ['ASSIGNED', 'CANCELLED'],
  REJECTED:    [],
  ASSIGNED:    ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED:   [],
  CANCELLED:   [],
};

// ─── Request / Response shapes ────────────────────────────────────────────────

export interface CreateIncidentInput {
  title: string;
  description: string;
  severity: IncidentSeverity;
  affectedPeople: number;
  latitude: number;
  longitude: number;
  timeSensitivity: TimeSensitivity;
  environmentalCondition?: string;
  resourceRequirements: string[];
}

export interface UpdateIncidentInput {
  title?: string;
  description?: string;
  severity?: IncidentSeverity;
  affectedPeople?: number;
  latitude?: number;
  longitude?: number;
  timeSensitivity?: TimeSensitivity;
  environmentalCondition?: string;
  resourceRequirements?: string[];
}

export interface UpdateStatusInput {
  status: IncidentStatus;
}

export interface IncidentFilters {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
}

// ─── Safe creator shape (no password) ────────────────────────────────────────

export interface SafeCreator {
  id: string;
  name: string;
  email: string;
  role: string;
}
