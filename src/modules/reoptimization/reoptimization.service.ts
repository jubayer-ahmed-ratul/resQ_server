/**
 * Re-optimization Service — Part 9
 *
 * Orchestrates dynamic re-optimization of incident resource assignments.
 *
 * Reuses without duplication:
 *   Part 5 — calculatePriority() via calculateAndSaveIncidentPriority()
 *   Part 6 — recommendResource() via findReplacementResource()
 *   Part 7 — assignment transaction pattern (cancel + create)
 *   Part 8 — buildAssignmentExplanation() for DecisionLog
 *
 * Transaction strategy (consistent with Part 7):
 *   All state changes (cancel old assignment, create new assignment,
 *   update resource statuses, write ReoptimizationLog, write DecisionLog)
 *   happen inside a single Prisma interactive transaction.
 *   On failure the entire transaction rolls back — no partial state.
 *
 * Concurrency:
 *   The transaction re-reads and re-validates all entities inside the
 *   transaction boundary. If another request has already replaced the
 *   assignment, the second request will find the assignment is no longer
 *   ACTIVE and return a clean business error.
 */

import httpStatus from 'http-status';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import prisma from '../../lib/prisma';
import { AppError } from '../../utils/errors';
import logger from '../../lib/logger';
import config from '../../config';
import { withRetry, isTransientError } from '../../reliability/retry';
import {
  ReoptimizeInput,
  ReoptimizationResult,
  REOPTIMIZATION_ERRORS,
  AccessCondition,
  ALLOW_PREEMPTION,
} from './reoptimization.interface';
import {
  assessCurrentAssignment,
  buildAlternativeCandidates,
  findReplacementResource,
  shouldPreempt,
} from './reoptimization.engine';
import { ResourceCandidate, ALGORITHM_VERSIONS } from '../decision/decision.interface';
import { buildAssignmentExplanation } from '../decision/decision.service';
import { calculateAndSaveIncidentPriority } from '../decision/decision.service';

// ─── Shared include for assignments ──────────────────────────────────────────

const assignmentInclude = {
  incident: {
    select: {
      id: true,
      title: true,
      status: true,
      severity: true,
      affectedPeople: true,
      latitude: true,
      longitude: true,
      resourceRequirements: true,
      priorityScore: true,
    },
  },
  resource: {
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      capacity: true,
      latitude: true,
      longitude: true,
    },
  },
} as const;

// ─── Operationally active incident statuses ───────────────────────────────────
// An incident must be in one of these states for re-optimization to apply.
// RESOLVED and CANCELLED incidents no longer need resource management.

const ACTIVE_INCIDENT_STATUSES = [
  'VALIDATED',
  'PROCESSING',
  'ASSIGNED',
  'DISPATCHED',
];

// ═══════════════════════════════════════════════════════════════════════════════
// Main re-optimization entry point
// ═══════════════════════════════════════════════════════════════════════════════

export const reoptimizeAssignment = async (
  input: ReoptimizeInput,
): Promise<ReoptimizationResult> => {
  const { assignmentId, trigger, accessCondition = 'NORMAL', competingIncidentPriority } = input;

  // ── Step 1: Load current assignment outside transaction (fast fail) ─────────
  const currentAssignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: assignmentInclude,
  });

  if (!currentAssignment) {
    throw new AppError(REOPTIMIZATION_ERRORS.ASSIGNMENT_NOT_FOUND, httpStatus.NOT_FOUND);
  }

  if (currentAssignment.status !== 'ACTIVE') {
    throw new AppError(
      `${REOPTIMIZATION_ERRORS.ASSIGNMENT_NOT_ACTIVE} Current status: "${currentAssignment.status}".`,
      httpStatus.CONFLICT,
    );
  }

  const incident = currentAssignment.incident;
  const currentResource = currentAssignment.resource;

  if (!ACTIVE_INCIDENT_STATUSES.includes(incident.status)) {
    throw new AppError(
      `${REOPTIMIZATION_ERRORS.INCIDENT_NOT_ACTIVE} Current status: "${incident.status}".`,
      httpStatus.CONFLICT,
    );
  }

  // ── Step 2: Handle HIGHER_PRIORITY_INCIDENT trigger ─────────────────────────
  if (trigger === 'HIGHER_PRIORITY_INCIDENT') {
    const currentPriority = incident.priorityScore ?? 0;
    const competingPriority = competingIncidentPriority ?? 0;

    if (!ALLOW_PREEMPTION) {
      // Policy: preemption is disabled — find a fresh resource from the pool,
      // do NOT take the resource currently serving this incident.
      // Log the attempt and return a no-preemption result.
      const reoptLog = await prisma.reoptimizationLog.create({
        data: {
          incidentId: incident.id,
          assignmentId,
          trigger,
          previousResourceId: currentResource.id,
          reason: `Higher-priority incident detected (priority ${competingPriority} vs current ${currentPriority}). Preemption is disabled by policy (ALLOW_PREEMPTION = false). Current resource "${currentResource.name}" will continue serving this incident.`,
          replaced: false,
        },
      });

      return {
        reoptimized: false,
        replacementFound: false,
        trigger,
        previousResource: {
          id: currentResource.id,
          name: currentResource.name,
          type: currentResource.type as string,
          status: currentResource.status as string,
        },
        newResource: null,
        newAssignmentId: null,
        cancelledAssignmentId: null,
        reasons: [
          `Trigger: HIGHER_PRIORITY_INCIDENT — competing priority score: ${competingPriority}.`,
          `Current incident priority: ${currentPriority}.`,
          `Preemption is disabled by policy (ALLOW_PREEMPTION = false).`,
          `Resource "${currentResource.name}" continues serving this incident.`,
        ],
        message: REOPTIMIZATION_ERRORS.PREEMPTION_DISABLED,
        reoptimizationLogId: reoptLog.id,
      };
    }

    // Preemption is enabled — check threshold
    if (!shouldPreempt(currentPriority, competingPriority)) {
      const reoptLog = await prisma.reoptimizationLog.create({
        data: {
          incidentId: incident.id,
          assignmentId,
          trigger,
          previousResourceId: currentResource.id,
          reason: `Higher-priority incident priority (${competingPriority}) does not exceed minimum preemption threshold above current incident (${currentPriority}). No preemption performed.`,
          replaced: false,
        },
      });

      return {
        reoptimized: false,
        replacementFound: false,
        trigger,
        previousResource: {
          id: currentResource.id,
          name: currentResource.name,
          type: currentResource.type as string,
          status: currentResource.status as string,
        },
        newResource: null,
        newAssignmentId: null,
        cancelledAssignmentId: null,
        reasons: [
          `Competing incident priority (${competingPriority}) does not exceed current incident priority (${currentPriority}) by the minimum threshold.`,
          `No preemption performed.`,
        ],
        message: 'Priority difference insufficient for preemption.',
        reoptimizationLogId: reoptLog.id,
      };
    }
  }

  // ── Step 3: Assess whether current resource is still feasible ───────────────
  const requirements = Array.isArray(incident.resourceRequirements)
    ? (incident.resourceRequirements as string[])
    : [];

  // Determine if this resource is BUSY because of THIS incident
  // (It should be — but we check to be safe. The active assignment for this
  // incident IS this assignment, so if status=BUSY it's from this assignment.)
  const isAssignedToThisIncident =
    currentResource.status === 'BUSY' || currentResource.status === 'AVAILABLE';

  const assessment = assessCurrentAssignment(
    currentResource.status as string,
    currentResource.capacity,
    incident.affectedPeople,
    requirements,
    currentResource.type as string,
    isAssignedToThisIncident,
    trigger,
  );

  // ACCESS_CONDITION_CHANGE + BLOCKED = current resource infeasible
  const effectiveAccessCondition: AccessCondition =
    trigger === 'ACCESS_CONDITION_CHANGE' ? accessCondition : 'NORMAL';

  const isBlockedByAccess =
    trigger === 'ACCESS_CONDITION_CHANGE' && accessCondition === 'BLOCKED';

  const currentFeasible = assessment.feasible && !isBlockedByAccess;
  const infeasibilityReason = isBlockedByAccess
    ? `Access route to incident is BLOCKED — current resource "${currentResource.name}" cannot reach the site.`
    : assessment.reason;

  if (currentFeasible) {
    // Current resource is still suitable — no replacement needed
    const reoptLog = await prisma.reoptimizationLog.create({
      data: {
        incidentId: incident.id,
        assignmentId,
        trigger,
        previousResourceId: currentResource.id,
        reason: `Current resource "${currentResource.name}" remains feasible after trigger "${trigger}". No replacement required.`,
        replaced: false,
      },
    });

    return {
      reoptimized: false,
      replacementFound: false,
      trigger,
      previousResource: {
        id: currentResource.id,
        name: currentResource.name,
        type: currentResource.type as string,
        status: currentResource.status as string,
      },
      newResource: null,
      newAssignmentId: null,
      cancelledAssignmentId: null,
      reasons: [`Current resource "${currentResource.name}" remains feasible. Re-optimization not needed.`],
      message: REOPTIMIZATION_ERRORS.CURRENT_RESOURCE_STILL_FEASIBLE,
      reoptimizationLogId: reoptLog.id,
    };
  }

  // ── Step 4: Find replacement resource ───────────────────────────────────────
  const allResources = await prisma.resource.findMany({
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

  const resourceCandidates: ResourceCandidate[] = allResources.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type as string,
    status: r.status as string,
    capacity: r.capacity,
    latitude: r.latitude,
    longitude: r.longitude,
  }));

  // Exclude the current (infeasible) resource from candidates
  const alternatives = buildAlternativeCandidates(resourceCandidates, [currentResource.id]);

  const allocationResult = findReplacementResource(
    incident.id,
    incident.latitude,
    incident.longitude,
    incident.affectedPeople,
    requirements,
    alternatives,
    config.resourceAverageSpeedKmh,
    effectiveAccessCondition,
  );

  // ── Step 5: No replacement found ────────────────────────────────────────────
  if (!allocationResult.selectedResource) {
    const reoptLog = await prisma.reoptimizationLog.create({
      data: {
        incidentId: incident.id,
        assignmentId,
        trigger,
        previousResourceId: currentResource.id,
        reason: `Current resource "${currentResource.name}" is no longer feasible (${infeasibilityReason ?? trigger}), but no suitable replacement was found.`,
        replaced: false,
      },
    });

    return {
      reoptimized: false,
      replacementFound: false,
      trigger,
      previousResource: {
        id: currentResource.id,
        name: currentResource.name,
        type: currentResource.type as string,
        status: currentResource.status as string,
      },
      newResource: null,
      newAssignmentId: null,
      cancelledAssignmentId: null,
      reasons: [
        `Current resource "${currentResource.name}" is no longer feasible: ${infeasibilityReason}.`,
        ...allocationResult.rejectedCandidates.map(
          (rc) => `Resource "${rc.resourceName}" rejected: ${rc.reason}`,
        ),
        'No suitable replacement found — assignment not changed.',
      ],
      message: REOPTIMIZATION_ERRORS.NO_REPLACEMENT_AVAILABLE,
      reoptimizationLogId: reoptLog.id,
    };
  }

  const replacement = allocationResult.selectedResource;

  // ── Step 6: Execute replacement inside a transaction ────────────────────────
  try {
    const txResult = await withRetry(
      () => prisma.$transaction(async (tx) => {
      // Re-read all entities inside the transaction to detect concurrent changes

      const assignment = await tx.assignment.findUnique({ where: { id: assignmentId } });
      if (!assignment || assignment.status !== 'ACTIVE') {
        throw new AppError(
          `${REOPTIMIZATION_ERRORS.ASSIGNMENT_NOT_ACTIVE} Assignment was already modified by a concurrent request.`,
          httpStatus.CONFLICT,
        );
      }

      const newResource = await tx.resource.findUnique({ where: { id: replacement.id } });
      if (!newResource || newResource.status !== 'AVAILABLE') {
        throw new AppError(
          `Replacement resource "${replacement.name}" is no longer AVAILABLE. Current status: "${newResource?.status ?? 'not found'}".`,
          httpStatus.CONFLICT,
        );
      }

      // Validate replacement resource still meets requirements
      if (requirements.length > 0) {
        const typeMatch = requirements
          .map((r) => r.toUpperCase())
          .includes(newResource.type.toUpperCase());
        if (!typeMatch) {
          throw new AppError(
            `Replacement resource type "${newResource.type}" no longer matches requirements [${requirements.join(', ')}].`,
            httpStatus.CONFLICT,
          );
        }
      }
      if (newResource.capacity < incident.affectedPeople) {
        throw new AppError(
          `Replacement resource capacity (${newResource.capacity}) is insufficient for ${incident.affectedPeople} affected people.`,
          httpStatus.CONFLICT,
        );
      }

      // 1. Cancel old assignment
      const cancelledAssignment = await tx.assignment.update({
        where: { id: assignmentId },
        data: { status: 'CANCELLED', releasedAt: new Date() },
      });

      // 2. Release old resource (FAILED/MAINTENANCE/UNAVAILABLE resources keep
      //    their current status — we only reset BUSY resources to AVAILABLE)
      const oldResourceCurrentStatus = (
        await tx.resource.findUnique({ where: { id: currentResource.id } })
      )?.status;
      if (oldResourceCurrentStatus === 'BUSY') {
        await tx.resource.update({
          where: { id: currentResource.id },
          data: { status: 'AVAILABLE' },
        });
      }

      // 3. Create new assignment
      const newAssignment = await tx.assignment.create({
        data: {
          incidentId: incident.id,
          resourceId: replacement.id,
          status: 'ACTIVE',
        },
      });

      // 4. Mark replacement resource BUSY
      await tx.resource.update({
        where: { id: replacement.id },
        data: { status: 'BUSY' },
      });

      // 5. Incident remains ASSIGNED (status unchanged — still has a resource)
      // No incident status update needed — it was ASSIGNED and remains ASSIGNED.

      // 6. Build assignment explanation (Part 8 reuse)
      const explanation = buildAssignmentExplanation(
        replacement.id,
        replacement.name,
        replacement.type as string,
        requirements,
      );

      // Augment reasons with re-optimization context
      const reoptReasons = [
        `Re-optimization trigger: ${trigger}.`,
        `Previous resource "${currentResource.name}" was no longer feasible: ${infeasibilityReason}.`,
        `Replacement resource "${replacement.name}" selected by Greedy Allocation Engine.`,
        `Estimated ETA: ${allocationResult.estimatedEtaMinutes} minutes (${allocationResult.estimatedDistanceKm} km).`,
        ...allocationResult.reasons,
      ];

      const augmentedExplanation = {
        ...explanation,
        summary: `Resource "${replacement.name}" assigned as replacement for "${currentResource.name}" after trigger: ${trigger}.`,
        reoptimizationTrigger: trigger,
        previousResourceId: currentResource.id,
        previousResourceName: currentResource.name,
        rejectedAlternatives: allocationResult.rejectedCandidates,
        reasons: reoptReasons,
      };

      // 7. Create DecisionLog (Part 8 reuse)
      const decisionLog = await tx.decisionLog.create({
        data: {
          incidentId: incident.id,
          selectedResourceId: replacement.id,
          decisionType: 'RESOURCE_ASSIGNMENT',
          explanation: augmentedExplanation as object,
          algorithmVersion: ALGORITHM_VERSIONS.ASSIGNMENT,
        },
      });

      // 8. Create ReoptimizationLog
      const reoptLog = await tx.reoptimizationLog.create({
        data: {
          incidentId: incident.id,
          assignmentId: assignmentId,
          trigger,
          previousResourceId: currentResource.id,
          newResourceId: replacement.id,
          reason: `Resource "${currentResource.name}" became infeasible (trigger: ${trigger}). Replaced with "${replacement.name}".`,
          decisionLogId: decisionLog.id,
          replaced: true,
        },
      });

      return {
        cancelledAssignment,
        newAssignment,
        decisionLog,
        reoptLog,
        reoptReasons,
      };
      }),
      {
        operationName: 'reoptimizeAssignment',
        shouldRetry: (err, attempt) => {
          if (err instanceof AppError) return false;
          if (err instanceof PrismaClientKnownRequestError) return false;
          const retry = isTransientError(err);
          if (retry) {
            logger.warn('[Reoptimization] Transient error — retrying transaction', {
              operation: 'reoptimizeAssignment',
              attempt,
              message: (err as Error).message,
            });
          }
          return retry;
        },
      },
    );

    return {
      reoptimized: true,
      replacementFound: true,
      trigger,
      previousResource: {
        id: currentResource.id,
        name: currentResource.name,
        type: currentResource.type as string,
        status: currentResource.status as string,
      },
      newResource: {
        id: replacement.id,
        name: replacement.name,
        type: replacement.type as string,
        status: 'BUSY',
      },
      newAssignmentId: txResult.newAssignment.id,
      cancelledAssignmentId: txResult.cancelledAssignment.id,
      reasons: txResult.reoptReasons,
      message: `Resource successfully replaced: "${currentResource.name}" → "${replacement.name}".`,
      reoptimizationLogId: txResult.reoptLog.id,
    };
  } catch (err) {
    // P2002 partial unique index violation — concurrent replacement already happened
    if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(
        'Re-optimization conflict: the assignment was already modified by a concurrent request.',
        httpStatus.CONFLICT,
      );
    }
    throw err;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// Re-optimization history retrieval
// ═══════════════════════════════════════════════════════════════════════════════

export const getReoptimizationLogsByIncident = async (incidentId: string) => {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) {
    throw new AppError('Incident not found.', httpStatus.NOT_FOUND);
  }

  return prisma.reoptimizationLog.findMany({
    where: { incidentId },
    orderBy: { createdAt: 'desc' },
    include: {
      previousResource: { select: { id: true, name: true, type: true } },
      newResource:      { select: { id: true, name: true, type: true } },
      assignment:       { select: { id: true, status: true } },
    },
  });
};

export const getReoptimizationLogById = async (id: string) => {
  const log = await prisma.reoptimizationLog.findUnique({
    where: { id },
    include: {
      incident:         { select: { id: true, title: true, status: true } },
      previousResource: { select: { id: true, name: true, type: true, status: true } },
      newResource:      { select: { id: true, name: true, type: true, status: true } },
      assignment:       { select: { id: true, status: true, assignedAt: true } },
    },
  });
  if (!log) {
    throw new AppError('Re-optimization log not found.', httpStatus.NOT_FOUND);
  }
  return log;
};

// ─── Re-export for use by workers (Part 10) ───────────────────────────────────
// The service is designed so it can be called by a background worker
// without changing its core logic. The input shape (ReoptimizeInput) is
// self-contained. Workers only need to import and call reoptimizeAssignment().
export { calculateAndSaveIncidentPriority };
