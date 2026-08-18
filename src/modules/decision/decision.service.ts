import httpStatus from 'http-status';
import prisma from '../../lib/prisma';
import { AppError } from '../../utils/errors';
import config from '../../config';
import { calculatePriority } from './decision.engine';
import { recommendResource } from './resource-allocation.engine';
import {
  PriorityCalculationResult,
  PriorityEngineInput,
  AllocationResult,
  ResourceCandidate,
  PriorityExplanation,
  RecommendationExplanation,
  AssignmentExplanation,
  ALGORITHM_VERSIONS,
  RejectionReasonCode,
  DecisionLogWithRelations,
} from './decision.interface';
import { IncidentSeverity, TimeSensitivity } from '../incident/incident.interface';

// ─── Shared DecisionLog include ───────────────────────────────────────────────

const decisionLogInclude = {
  incident: {
    select: { id: true, title: true, status: true, severity: true },
  },
  selectedResource: {
    select: { id: true, name: true, type: true },
  },
} as const;

// ─── Rejection reason classifier ─────────────────────────────────────────────
// Maps free-text rejection reasons from Part 6 to structured reason codes.

function classifyRejectionReason(reason: string): RejectionReasonCode {
  const lower = reason.toLowerCase();
  if (lower.includes('busy')) return 'RESOURCE_BUSY';
  if (lower.includes('unavailable')) return 'RESOURCE_UNAVAILABLE';
  if (lower.includes('failed')) return 'RESOURCE_FAILED';
  if (lower.includes('maintenance')) return 'RESOURCE_MAINTENANCE';
  if (lower.includes('capacity')) return 'CAPACITY_INSUFFICIENT';
  if (lower.includes('type') || lower.includes('match') || lower.includes('requirement'))
    return 'CAPABILITY_MISMATCH';
  return 'INVALID_LOCATION';
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART 5 + 8 — Priority calculation with DecisionLog
// ═══════════════════════════════════════════════════════════════════════════════

export const calculateAndSaveIncidentPriority = async (
  incidentId: string,
): Promise<PriorityCalculationResult> => {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });

  if (!incident) {
    throw new AppError('Incident not found.', httpStatus.NOT_FOUND);
  }

  const engineInput: PriorityEngineInput = {
    severity: incident.severity as IncidentSeverity,
    timeSensitivity: incident.timeSensitivity as TimeSensitivity,
    affectedPeople: incident.affectedPeople,
    environmentalCondition: incident.environmentalCondition,
    resourceRequirements: Array.isArray(incident.resourceRequirements)
      ? (incident.resourceRequirements as string[])
      : [],
  };

  const result = calculatePriority(engineInput);

  // Build structured priority explanation
  const explanation: PriorityExplanation = {
    summary: `Incident priority score calculated as ${result.priorityScore}/100 using weighted multi-factor heuristic.`,
    algorithm: 'WEIGHTED_PRIORITY_HEURISTIC',
    algorithmVersion: ALGORITHM_VERSIONS.PRIORITY,
    factors: {
      severity: {
        value: result.factors.severity.rawValue as string,
        normalizedScore: result.factors.severity.normalizedScore,
        weight: 0.30,
        contribution: result.factors.severity.weightedScore,
      },
      timeSensitivity: {
        value: result.factors.timeSensitivity.rawValue as string,
        normalizedScore: result.factors.timeSensitivity.normalizedScore,
        weight: 0.25,
        contribution: result.factors.timeSensitivity.weightedScore,
      },
      affectedPopulation: {
        value: result.factors.affectedPopulation.rawValue as number,
        normalizedScore: result.factors.affectedPopulation.normalizedScore,
        weight: 0.20,
        contribution: result.factors.affectedPopulation.weightedScore,
      },
      environmentalRisk: {
        normalizedScore: result.factors.environmentalRisk.normalizedScore,
        weight: 0.15,
        contribution: result.factors.environmentalRisk.weightedScore,
      },
      resourceRequirements: {
        value: result.factors.resourceRequirements.rawValue as number,
        normalizedScore: result.factors.resourceRequirements.normalizedScore,
        weight: 0.10,
        contribution: result.factors.resourceRequirements.weightedScore,
      },
    },
    reasons: result.reasons,
  };

  // Persist priorityScore + create DecisionLog atomically
  await prisma.$transaction([
    prisma.incident.update({
      where: { id: incidentId },
      data: { priorityScore: result.priorityScore },
    }),
    prisma.decisionLog.create({
      data: {
        incidentId,
        decisionType: 'PRIORITY_CALCULATION',
        priorityScore: result.priorityScore,
        explanation: explanation as object,
        algorithmVersion: ALGORITHM_VERSIONS.PRIORITY,
      },
    }),
  ]);

  return result;
};

// ═══════════════════════════════════════════════════════════════════════════════
// PART 6 + 8 — Resource recommendation with DecisionLog
// ═══════════════════════════════════════════════════════════════════════════════

export const recommendResourceForIncident = async (
  incidentId: string,
): Promise<AllocationResult> => {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: {
      id: true,
      latitude: true,
      longitude: true,
      affectedPeople: true,
      resourceRequirements: true,
    },
  });

  if (!incident) {
    throw new AppError('Incident not found.', httpStatus.NOT_FOUND);
  }

  const resources = await prisma.resource.findMany({
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      capacity: true,
      latitude: true,
      longitude: true,
    },
  });

  const resourceCandidates: ResourceCandidate[] = resources.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type as string,
    status: r.status as string,
    capacity: r.capacity,
    latitude: r.latitude,
    longitude: r.longitude,
  }));

  // Run greedy engine — pure, no side effects
  const result = recommendResource({
    incidentId: incident.id,
    incidentLatitude: incident.latitude,
    incidentLongitude: incident.longitude,
    affectedPeople: incident.affectedPeople,
    resourceRequirements: Array.isArray(incident.resourceRequirements)
      ? (incident.resourceRequirements as string[])
      : [],
    availableResources: resourceCandidates,
    averageSpeedKmh: config.resourceAverageSpeedKmh,
  });

  // Build structured recommendation explanation
  const feasibleCount = result.candidateEvaluations.filter((e) => e.feasible).length;

  const explanation: RecommendationExplanation = {
    summary: result.selectedResource
      ? `Resource "${result.selectedResource.name}" selected as the best available option with estimated ETA of ${result.estimatedEtaMinutes} minutes.`
      : 'No suitable resource is currently available for this incident.',
    algorithm: 'GREEDY_RESOURCE_ALLOCATION',
    algorithmVersion: ALGORITHM_VERSIONS.GREEDY_RESOURCE,
    selected: result.selectedResource
      ? {
          resourceId: result.selectedResource.id,
          resourceName: result.selectedResource.name,
          resourceType: result.selectedResource.type,
          distanceKm: result.estimatedDistanceKm ?? 0,
          etaMinutes: result.estimatedEtaMinutes ?? 0,
          capacity: result.selectedResource.capacity,
        }
      : null,
    rejected: result.rejectedCandidates.map((rc) => ({
      resourceId: rc.resourceId,
      resourceName: rc.resourceName,
      code: classifyRejectionReason(rc.reason),
      message: rc.reason,
    })),
    candidateCount: result.candidateEvaluations.length,
    feasibleCount,
    reasons: result.reasons,
  };

  // Persist DecisionLog — read-only operation (resource status unchanged)
  await prisma.decisionLog.create({
    data: {
      incidentId,
      selectedResourceId: result.selectedResource?.id ?? null,
      decisionType: 'RESOURCE_RECOMMENDATION',
      explanation: explanation as object,
      algorithmVersion: ALGORITHM_VERSIONS.GREEDY_RESOURCE,
    },
  });

  return result;
};

// ═══════════════════════════════════════════════════════════════════════════════
// PART 7 + 8 — Assignment explanation logging
// Called from assignment.service INSIDE the transaction
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * buildAssignmentExplanation
 *
 * Constructs a structured AssignmentExplanation for a successfully
 * completed assignment transaction.
 * This is a pure function — no DB access.
 */
export function buildAssignmentExplanation(
  resourceId: string,
  resourceName: string,
  resourceType: string,
  incidentRequirements: string[],
): AssignmentExplanation {
  return {
    summary: `Resource "${resourceName}" officially assigned to incident.`,
    algorithm: 'TRANSACTIONAL_ASSIGNMENT',
    algorithmVersion: ALGORITHM_VERSIONS.ASSIGNMENT,
    resource: { resourceId, resourceName, resourceType },
    reasons: [
      `Resource "${resourceName}" was AVAILABLE at the time of assignment.`,
      incidentRequirements.length > 0
        ? `Resource type "${resourceType}" matched incident requirement [${incidentRequirements.join(', ')}].`
        : `No specific resource type requirement — resource type "${resourceType}" accepted.`,
      'Resource capacity was verified as sufficient for the affected population.',
      'No conflicting active assignment existed for this resource.',
      'No conflicting active assignment existed for this incident.',
      'Assignment transaction committed successfully.',
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART 8 — Decision log retrieval
// ═══════════════════════════════════════════════════════════════════════════════

export const getDecisionsByIncident = async (
  incidentId: string,
): Promise<DecisionLogWithRelations[]> => {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) {
    throw new AppError('Incident not found.', httpStatus.NOT_FOUND);
  }

  return prisma.decisionLog.findMany({
    where: { incidentId },
    orderBy: { createdAt: 'desc' },
    include: decisionLogInclude,
  }) as Promise<DecisionLogWithRelations[]>;
};

export const getDecisionById = async (
  id: string,
): Promise<DecisionLogWithRelations> => {
  const log = await prisma.decisionLog.findUnique({
    where: { id },
    include: decisionLogInclude,
  });
  if (!log) {
    throw new AppError('Decision log not found.', httpStatus.NOT_FOUND);
  }
  return log as DecisionLogWithRelations;
};
