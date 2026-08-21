import httpStatus from 'http-status';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { IncidentStatus as PrismaIncidentStatus } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../utils/errors';
import logger from '../../lib/logger';
import { withRetry, isTransientError } from '../../reliability/retry';
import {
  CreateAssignmentInput,
  AssignmentFilters,
  ASSIGNMENT_ERRORS,
  AssignmentStatus,
  ALLOWED_ASSIGNMENT_TRANSITIONS,
} from './assignment.interface';
import { buildAssignmentExplanation } from '../decision/decision.service';
import { ALGORITHM_VERSIONS } from '../decision/decision.interface';
import { createEvent } from '../../events/event.publisher';
import { EventType } from '../../events/event.types';
import { writeOutboxEvent } from '../../events/outbox/outbox.helper';
import { PaginationParams, PaginatedResult, buildPaginationMeta } from '../../utils/pagination';
import { AuthUser } from '../../middlewares/auth';

// ─── Eligible incident statuses for assignment ────────────────────────────────
// An incident must be APPROVED before it can be ASSIGNED.
// PENDING incidents must first be approved by a coordinator.
// REJECTED incidents can never be assigned.

const ASSIGNABLE_INCIDENT_STATUSES = ['APPROVED'];

// ─── Shared include shape ─────────────────────────────────────────────────────

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

// ─── Create assignment ────────────────────────────────────────────────────────
/**
 * Transactional assignment creation.
 *
 * Concurrency strategy:
 *   Prisma's $transaction runs in READ COMMITTED isolation by default on
 *   PostgreSQL. The partial unique indexes on (resourceId WHERE ACTIVE) and
 *   (incidentId WHERE ACTIVE) act as the final database-level guard.
 *   Even if two concurrent transactions both pass the application-level checks,
 *   the second INSERT will violate the partial unique index and throw P2002,
 *   which is caught and converted to a clean business error.
 *
 *   This means: application checks = fast fail path; DB constraint = safety net.
 */
export const createAssignment = async (input: CreateAssignmentInput) => {
  const { incidentId, resourceId } = input;

  try {
    return await withRetry(
      () => prisma.$transaction(async (tx) => {
      // 1. Verify incident exists and is eligible
      const incident = await tx.incident.findUnique({ where: { id: incidentId } });
      if (!incident) {
        throw new AppError('Incident not found.', httpStatus.NOT_FOUND);
      }
      if (!ASSIGNABLE_INCIDENT_STATUSES.includes(incident.status)) {
        throw new AppError(
          `${ASSIGNMENT_ERRORS.INCIDENT_NOT_ELIGIBLE} Current status: "${incident.status}". Required: APPROVED.`,
          httpStatus.CONFLICT,
        );
      }

      // 2. Verify resource exists and is AVAILABLE
      const resource = await tx.resource.findUnique({ where: { id: resourceId } });
      if (!resource) {
        throw new AppError('Resource not found.', httpStatus.NOT_FOUND);
      }
      if (resource.status !== 'AVAILABLE') {
        throw new AppError(
          `${ASSIGNMENT_ERRORS.RESOURCE_NOT_AVAILABLE} Current status: "${resource.status}".`,
          httpStatus.CONFLICT,
        );
      }

      // 3. Check resource type matches incident requirements
      const requirements = Array.isArray(incident.resourceRequirements)
        ? (incident.resourceRequirements as string[])
        : [];
      if (
        requirements.length > 0 &&
        !requirements.map((r) => r.toUpperCase()).includes(resource.type.toUpperCase())
      ) {
        throw new AppError(
          `${ASSIGNMENT_ERRORS.RESOURCE_TYPE_MISMATCH} Required: [${requirements.join(', ')}]. Resource type: "${resource.type}".`,
          httpStatus.CONFLICT,
        );
      }

      // 4. Check resource capacity
      if (resource.capacity < incident.affectedPeople) {
        throw new AppError(
          `${ASSIGNMENT_ERRORS.RESOURCE_CAPACITY_INSUFFICIENT} Capacity: ${resource.capacity}, Affected people: ${incident.affectedPeople}.`,
          httpStatus.CONFLICT,
        );
      }

      // 5. Application-level duplicate check (fast fail before DB constraint)
      const existingResourceAssignment = await tx.assignment.findFirst({
        where: { resourceId, status: 'ACTIVE' },
      });
      if (existingResourceAssignment) {
        throw new AppError(
          ASSIGNMENT_ERRORS.RESOURCE_ALREADY_ASSIGNED,
          httpStatus.CONFLICT,
        );
      }

      const existingIncidentAssignment = await tx.assignment.findFirst({
        where: { incidentId, status: 'ACTIVE' },
      });
      if (existingIncidentAssignment) {
        throw new AppError(
          ASSIGNMENT_ERRORS.INCIDENT_ALREADY_ASSIGNED,
          httpStatus.CONFLICT,
        );
      }

      // 6. Create the assignment (ACTIVE immediately)
      const assignment = await tx.assignment.create({
        data: { incidentId, resourceId, status: 'ACTIVE' },
        include: assignmentInclude,
      });

      // 7. Mark resource as BUSY
      await tx.resource.update({
        where: { id: resourceId },
        data: { status: 'BUSY' },
      });

      // 8. Move incident to ASSIGNED
      await tx.incident.update({
        where: { id: incidentId },
        data: { status: 'ASSIGNED' },
      });

      // 9. Create DecisionLog inside the same transaction — atomic with assignment
      const explanation = buildAssignmentExplanation(
        resourceId,
        resource.name,
        resource.type as string,
        requirements,
      );

      await tx.decisionLog.create({
        data: {
          incidentId,
          selectedResourceId: resourceId,
          decisionType: 'RESOURCE_ASSIGNMENT',
          explanation: explanation as object,
          algorithmVersion: ALGORITHM_VERSIONS.ASSIGNMENT,
        },
      });

      // 10. Write ASSIGNMENT_CREATED outbox event — atomic with assignment
      await writeOutboxEvent(
        tx,
        createEvent(EventType.ASSIGNMENT_CREATED, {
          assignmentId: assignment.id,
          incidentId,
          resourceId,
        }),
      );

      return assignment;
      }),
      {
        operationName: 'createAssignment',
        // Only retry genuine transient DB errors — never retry business conflicts
        shouldRetry: (err, attempt) => {
          if (err instanceof AppError) return false; // business errors are final
          if (err instanceof PrismaClientKnownRequestError) return false; // constraint violations are final
          const retry = isTransientError(err);
          if (retry) {
            logger.warn('[Assignment] Transient error on createAssignment — retrying', {
              operation: 'createAssignment',
              attempt,
              message: (err as Error).message,
            });
          }
          return retry;
        },
      },
    );
  } catch (err) {
    // DB-level partial unique index violation — catches race conditions
    if (
      err instanceof PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const target = (err.meta?.['target'] as string[] | undefined) ?? [];
      if (target.some((t) => t.includes('resourceId'))) {
        throw new AppError(
          ASSIGNMENT_ERRORS.RESOURCE_ALREADY_ASSIGNED,
          httpStatus.CONFLICT,
        );
      }
      if (target.some((t) => t.includes('incidentId'))) {
        throw new AppError(
          ASSIGNMENT_ERRORS.INCIDENT_ALREADY_ASSIGNED,
          httpStatus.CONFLICT,
        );
      }
      throw new AppError(
        ASSIGNMENT_ERRORS.RESOURCE_ALREADY_ASSIGNED,
        httpStatus.CONFLICT,
      );
    }
    throw err;
  }
};

// ─── Complete assignment ──────────────────────────────────────────────────────

export const completeAssignment = async (id: string) => {
  return withRetry(
    () => prisma.$transaction(async (tx) => {
    const assignment = await tx.assignment.findUnique({ where: { id } });
    if (!assignment) {
      throw new AppError('Assignment not found.', httpStatus.NOT_FOUND);
    }

    const current = assignment.status as AssignmentStatus;
    if (!ALLOWED_ASSIGNMENT_TRANSITIONS[current].includes('COMPLETED')) {
      throw new AppError(
        `${ASSIGNMENT_ERRORS.INVALID_ASSIGNMENT_STATE} Cannot complete from "${current}".`,
        httpStatus.BAD_REQUEST,
      );
    }

    // Assignment → COMPLETED
    const updated = await tx.assignment.update({
      where: { id },
      data: { status: 'COMPLETED', releasedAt: new Date() },
      include: assignmentInclude,
    });

    // Resource → AVAILABLE
    await tx.resource.update({
      where: { id: assignment.resourceId },
      data: { status: 'AVAILABLE' },
    });

    // Incident → IN_PROGRESS (next valid operational status after ASSIGNED)
    await tx.incident.update({
      where: { id: assignment.incidentId },
      data: { status: 'IN_PROGRESS' as PrismaIncidentStatus },
    });

    // Outbox: ASSIGNMENT_COMPLETED
    await writeOutboxEvent(
      tx,
      createEvent(EventType.ASSIGNMENT_COMPLETED, {
        assignmentId: id,
        incidentId:   assignment.incidentId,
        resourceId:   assignment.resourceId,
      }),
    );

    return updated;
  }),
  {
    operationName: 'completeAssignment',
    shouldRetry: (err) => {
      if (err instanceof AppError) return false;
      if (err instanceof PrismaClientKnownRequestError) return false;
      return isTransientError(err);
    },
  },
  );
};

// ─── Cancel assignment ────────────────────────────────────────────────────────

export const cancelAssignment = async (id: string) => {
  return withRetry(
    () => prisma.$transaction(async (tx) => {
    const assignment = await tx.assignment.findUnique({ where: { id } });
    if (!assignment) {
      throw new AppError('Assignment not found.', httpStatus.NOT_FOUND);
    }

    const current = assignment.status as AssignmentStatus;
    if (!ALLOWED_ASSIGNMENT_TRANSITIONS[current].includes('CANCELLED')) {
      throw new AppError(
        `${ASSIGNMENT_ERRORS.INVALID_ASSIGNMENT_STATE} Cannot cancel from "${current}".`,
        httpStatus.BAD_REQUEST,
      );
    }

    // Assignment → CANCELLED
    const updated = await tx.assignment.update({
      where: { id },
      data: { status: 'CANCELLED', releasedAt: new Date() },
      include: assignmentInclude,
    });

    // Resource → AVAILABLE (only if it was BUSY due to this assignment)
    await tx.resource.update({
      where: { id: assignment.resourceId },
      data: { status: 'AVAILABLE' },
    });

    // Incident → APPROVED (back to pre-assignment operational state)
    // Rationale: incident still needs attention — return to APPROVED
    // so coordinators can assign a different resource.
    const incident = await tx.incident.findUnique({
      where: { id: assignment.incidentId },
    });
    if (incident && incident.status === 'ASSIGNED') {
      await tx.incident.update({
        where: { id: assignment.incidentId },
        data: { status: 'APPROVED' as PrismaIncidentStatus },
      });
    }

    // Outbox: ASSIGNMENT_CANCELLED
    await writeOutboxEvent(
      tx,
      createEvent(EventType.ASSIGNMENT_CANCELLED, {
        assignmentId: id,
        incidentId:   assignment.incidentId,
        resourceId:   assignment.resourceId,
      }),
    );

    return updated;
  }),
  {
    operationName: 'cancelAssignment',
    shouldRetry: (err) => {
      if (err instanceof AppError) return false;
      if (err instanceof PrismaClientKnownRequestError) return false;
      return isTransientError(err);
    },
  },
  );
};

// ─── Get single assignment ────────────────────────────────────────────────────

export const getAssignmentById = async (id: string) => {
  const assignment = await prisma.assignment.findUnique({
    where: { id },
    include: assignmentInclude,
  });
  if (!assignment) {
    throw new AppError('Assignment not found.', httpStatus.NOT_FOUND);
  }
  return assignment;
};

// ─── List assignments ─────────────────────────────────────────────────────────

export const getAssignments = async (
  filters: AssignmentFilters,
  pagination?: PaginationParams,
  user?: AuthUser,
) => {
  const where: Record<string, unknown> = {};
  if (filters.incidentId) where['incidentId'] = filters.incidentId;
  if (filters.resourceId) where['resourceId'] = filters.resourceId;
  if (filters.status) where['status'] = filters.status;

  // OPERATOR: only see assignments for their resources
  if (user && user.role === 'OPERATOR') {
    where['resource'] = { operatorId: user.userId };
  }

  // CITIZEN: only see assignments for their own incidents
  if (user && user.role === 'CITIZEN') {
    where['incident'] = { createdById: user.userId };
  }

  if (pagination) {
    const { skip, take } = buildPaginationMeta(pagination);
    const [total, items] = await Promise.all([
      prisma.assignment.count({ where }),
      prisma.assignment.findMany({
        where,
        orderBy: { assignedAt: 'desc' },
        skip,
        take,
        include: assignmentInclude,
      }),
    ]);

    const result: PaginatedResult<typeof items[number]> = {
      data: items,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
        hasNextPage: pagination.page * pagination.limit < total,
        hasPrevPage: pagination.page > 1,
      },
    };
    return result;
  }

  return prisma.assignment.findMany({
    where,
    orderBy: { assignedAt: 'desc' },
    include: assignmentInclude,
  });
};