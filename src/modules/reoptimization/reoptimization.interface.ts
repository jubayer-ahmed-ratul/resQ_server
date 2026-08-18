// ─── Re-optimization Triggers ────────────────────────────────────────────────
// Each trigger represents a specific condition that invalidates or challenges
// an existing assignment. The list is extensible — add new values here and
// in the Prisma enum to support additional scenarios.

export type ReoptimizationTrigger =
  | 'RESOURCE_FAILURE'        // Assigned resource status = FAILED
  | 'RESOURCE_UNAVAILABLE'    // Assigned resource status = UNAVAILABLE
  | 'RESOURCE_MAINTENANCE'    // Assigned resource status = MAINTENANCE
  | 'ACCESS_CONDITION_CHANGE' // Road/access condition around incident changed
  | 'HIGHER_PRIORITY_INCIDENT'// A new or updated incident has higher priority
  | 'CAPACITY_CHANGE';        // Resource capacity dropped below affectedPeople

// ─── Access condition ─────────────────────────────────────────────────────────
// Lightweight representation of road/access conditions.
//
// LIMITATION: This implementation applies a simple ETA penalty multiplier.
// It does NOT integrate a real road-network or routing API.
// The system cannot determine exact route feasibility from geographic data alone.
// BLOCKED is treated as: route is impassable — resource excluded from candidates.
// DIFFICULT applies a 1.5× ETA penalty to affected resource ETAs.
// NORMAL uses the standard Haversine + average-speed calculation.

export type AccessCondition = 'NORMAL' | 'DIFFICULT' | 'BLOCKED';

// ETA penalty multipliers per access condition
export const ACCESS_CONDITION_ETA_MULTIPLIER: Record<AccessCondition, number> = {
  NORMAL: 1.0,
  DIFFICULT: 1.5,
  BLOCKED: Infinity, // resource effectively unreachable
};

// ─── Preemption policy ────────────────────────────────────────────────────────
// Controls whether a resource ACTIVELY serving one incident can be
// reassigned to a higher-priority incident.
//
// Default: false — resources cannot be stolen from active incidents.
// Rationale: preemption mid-response may cause more harm than staying.
// An explicit policy decision is required to enable it.

export const ALLOW_PREEMPTION = false;

// ─── Re-optimization input ────────────────────────────────────────────────────

export interface ReoptimizeInput {
  assignmentId: string;
  trigger: ReoptimizationTrigger;
  // Optional: override access condition for the incident location.
  // If omitted, NORMAL is assumed.
  accessCondition?: AccessCondition;
  // Optional: context for HIGHER_PRIORITY_INCIDENT trigger.
  // Provide the competing incident's priority score.
  competingIncidentPriority?: number;
}

// ─── Feasibility assessment ───────────────────────────────────────────────────

export interface CurrentAssignmentAssessment {
  assignmentId: string;
  incidentId: string;
  resourceId: string;
  resourceName: string;
  resourceStatus: string;
  resourceCapacity: number;
  incidentAffectedPeople: number;
  incidentRequirements: string[];
  isFeasible: boolean;
  infeasibilityReason: string | null;
}

// ─── Re-optimization result ───────────────────────────────────────────────────

export interface ReoptimizationResult {
  reoptimized: boolean;
  replacementFound: boolean;
  trigger: ReoptimizationTrigger;
  previousResource: {
    id: string;
    name: string;
    type: string;
    status: string;
  } | null;
  newResource: {
    id: string;
    name: string;
    type: string;
    status: string;
  } | null;
  // Present when replacement succeeded
  newAssignmentId: string | null;
  // Present when replacement succeeded
  cancelledAssignmentId: string | null;
  reasons: string[];
  message: string;
  // ReoptimizationLog id for audit trail
  reoptimizationLogId: string | null;
}

// ─── Re-optimization errors ───────────────────────────────────────────────────

export const REOPTIMIZATION_ERRORS = {
  ASSIGNMENT_NOT_FOUND: 'Assignment not found.',
  ASSIGNMENT_NOT_ACTIVE: 'Re-optimization requires an ACTIVE assignment.',
  INCIDENT_NOT_ACTIVE: 'Incident is not in an operational state.',
  CURRENT_RESOURCE_STILL_FEASIBLE: 'Current resource remains feasible — re-optimization not needed.',
  NO_REPLACEMENT_AVAILABLE: 'No suitable replacement resource is currently available.',
  PREEMPTION_DISABLED: 'Resource preemption is disabled by policy (ALLOW_PREEMPTION = false).',
} as const;
