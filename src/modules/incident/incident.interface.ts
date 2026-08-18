// ─── Enums (mirrors Prisma enums — avoids importing generated client in interfaces) ──

export type IncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type IncidentStatus =
  | 'PENDING'
  | 'VALIDATED'
  | 'PROCESSING'
  | 'ASSIGNED'
  | 'DISPATCHED'
  | 'RESOLVED'
  | 'CANCELLED';
export type TimeSensitivity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// ─── Status transition map ────────────────────────────────────────────────────

/**
 * Allowed forward transitions for operational status changes.
 *
 * Rules:
 *   PENDING     → VALIDATED   (via /validate endpoint by ADMIN|COORDINATOR)
 *   VALIDATED   → PROCESSING  (by ADMIN|COORDINATOR)
 *   PROCESSING  → ASSIGNED    (by ADMIN|COORDINATOR)
 *   ASSIGNED    → DISPATCHED  (by ADMIN|COORDINATOR)
 *   DISPATCHED  → RESOLVED    (by ADMIN|COORDINATOR)
 *   any non-RESOLVED/CANCELLED → CANCELLED (by ADMIN|COORDINATOR only)
 *
 * Citizens cannot perform any status transitions directly.
 */
export const ALLOWED_STATUS_TRANSITIONS: Record<
  IncidentStatus,
  IncidentStatus[]
> = {
  PENDING: ['VALIDATED', 'CANCELLED'],
  VALIDATED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['RESOLVED', 'CANCELLED'],
  RESOLVED: [],
  CANCELLED: [],
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
