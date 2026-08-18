import { IncidentSeverity, TimeSensitivity } from '../incident/incident.interface';

// ═══════════════════════════════════════════════════════════════════════════════
// PART 5 — Priority Engine interfaces
// ═══════════════════════════════════════════════════════════════════════════════

export interface PriorityFactorResult {
  rawValue?: string | number;
  normalizedScore: number;
  weightedScore: number;
  reason: string;
}

export interface PriorityCalculationResult {
  priorityScore: number;
  factors: {
    severity: PriorityFactorResult;
    timeSensitivity: PriorityFactorResult;
    affectedPopulation: PriorityFactorResult;
    environmentalRisk: PriorityFactorResult;
    resourceRequirements: PriorityFactorResult;
  };
  reasons: string[];
}

export interface PriorityEngineInput {
  severity: IncidentSeverity;
  timeSensitivity: TimeSensitivity;
  affectedPeople: number;
  environmentalCondition: string | null;
  resourceRequirements: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART 6 — Resource Allocation Engine interfaces
// ═══════════════════════════════════════════════════════════════════════════════

export interface ResourceCandidate {
  id: string;
  name: string;
  type: string;
  status: string;
  capacity: number;
  latitude: number;
  longitude: number;
}

export interface AllocationEngineInput {
  incidentId: string;
  incidentLatitude: number;
  incidentLongitude: number;
  affectedPeople: number;
  resourceRequirements: string[];
  availableResources: ResourceCandidate[];
  averageSpeedKmh: number;
}

export interface CandidateEvaluation {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  feasible: boolean;
  rejectionReason?: string;
  estimatedDistanceKm?: number;
  estimatedEtaMinutes?: number;
  capacityFit?: number;
}

export interface SelectedResourceSummary {
  id: string;
  name: string;
  type: string;
  status: string;
  capacity: number;
  latitude: number;
  longitude: number;
}

export interface AllocationResult {
  incidentId: string;
  selectedResource: SelectedResourceSummary | null;
  estimatedDistanceKm: number | null;
  estimatedEtaMinutes: number | null;
  reasons: string[];
  rejectedCandidates: Array<{ resourceId: string; resourceName: string; reason: string }>;
  candidateEvaluations: CandidateEvaluation[];
  message: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART 8 — Explainable Decisions interfaces
// ═══════════════════════════════════════════════════════════════════════════════

export type DecisionType =
  | 'PRIORITY_CALCULATION'
  | 'RESOURCE_RECOMMENDATION'
  | 'RESOURCE_ASSIGNMENT'
  | 'RESOURCE_REJECTION';

// ─── Algorithm version constants ──────────────────────────────────────────────
export const ALGORITHM_VERSIONS = {
  PRIORITY: 'priority-v1',
  GREEDY_RESOURCE: 'greedy-resource-v1',
  ASSIGNMENT: 'assignment-v1',
} as const;

// ─── Structured rejection reason ─────────────────────────────────────────────
export type RejectionReasonCode =
  | 'RESOURCE_BUSY'
  | 'RESOURCE_UNAVAILABLE'
  | 'RESOURCE_FAILED'
  | 'RESOURCE_MAINTENANCE'
  | 'CAPACITY_INSUFFICIENT'
  | 'CAPABILITY_MISMATCH'
  | 'INVALID_LOCATION';

export interface RejectionReason {
  code: RejectionReasonCode;
  message: string;
}

// ─── Priority explanation stored in DecisionLog.explanation ──────────────────
export interface PriorityExplanation {
  summary: string;
  algorithm: string;
  algorithmVersion: string;
  factors: {
    severity: { value: string; normalizedScore: number; weight: number; contribution: number };
    timeSensitivity: { value: string; normalizedScore: number; weight: number; contribution: number };
    affectedPopulation: { value: number; normalizedScore: number; weight: number; contribution: number };
    environmentalRisk: { normalizedScore: number; weight: number; contribution: number };
    resourceRequirements: { value: number; normalizedScore: number; weight: number; contribution: number };
  };
  reasons: string[];
}

// ─── Resource recommendation explanation ─────────────────────────────────────
export interface RecommendationExplanation {
  summary: string;
  algorithm: string;
  algorithmVersion: string;
  selected: {
    resourceId: string;
    resourceName: string;
    resourceType: string;
    distanceKm: number;
    etaMinutes: number;
    capacity: number;
  } | null;
  rejected: Array<{
    resourceId: string;
    resourceName: string;
    code: RejectionReasonCode;
    message: string;
  }>;
  candidateCount: number;
  feasibleCount: number;
  reasons: string[];
}

// ─── Assignment explanation ───────────────────────────────────────────────────
export interface AssignmentExplanation {
  summary: string;
  algorithm: string;
  algorithmVersion: string;
  resource: {
    resourceId: string;
    resourceName: string;
    resourceType: string;
  };
  reasons: string[];
}

// ─── DecisionLog with relations (returned by service) ────────────────────────
export interface DecisionLogWithRelations {
  id: string;
  incidentId: string;
  selectedResourceId: string | null;
  decisionType: DecisionType;
  priorityScore: number | null;
  explanation: unknown;
  algorithmVersion: string;
  createdAt: Date;
  incident?: {
    id: string;
    title: string;
    status: string;
    severity: string;
  };
  selectedResource?: {
    id: string;
    name: string;
    type: string;
  } | null;
}
