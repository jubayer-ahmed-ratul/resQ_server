import httpStatus from 'http-status';
import { IncidentStatus as PrismaIncidentStatus, IncidentSeverity as PrismaIncidentSeverity } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../utils/errors';
import {
  CreateIncidentInput,
  UpdateIncidentInput,
  UpdateStatusInput,
  IncidentFilters,
  ALLOWED_STATUS_TRANSITIONS,
  IncidentStatus,
} from './incident.interface';
import { calculateAndSaveIncidentPriority } from '../decision/decision.service';
import { createEvent } from '../../events/event.publisher';
import { EventType } from '../../events/event.types';
import { writeOutboxEventDirect } from '../../events/outbox/outbox.helper';
import { PaginationParams, PaginatedResult, buildPaginationMeta } from '../../utils/pagination';
import { AuthUser } from '../../middlewares/auth';

// ─── Priority-relevant fields ─────────────────────────────────────────────────

const PRIORITY_FIELDS: (keyof UpdateIncidentInput)[] = [
  'severity',
  'affectedPeople',
  'timeSensitivity',
  'environmentalCondition',
  'resourceRequirements',
];

function touchesPriorityFields(input: UpdateIncidentInput): boolean {
  return PRIORITY_FIELDS.some((field) => input[field] !== undefined);
}

// ─── Shared include shape ─────────────────────────────────────────────────────

const incidentInclude = {
  createdBy: {
    select: { id: true, name: true, email: true, role: true },
  },
} as const;

// ─── Create ───────────────────────────────────────────────────────────────────

export const createIncident = async (
  input: CreateIncidentInput,
  userId: string,
  userRole: string,
) => {
  // OPERATOR/ADMIN-created incidents are auto-approved — no coordinator approval needed.
  // CITIZEN-created incidents start as PENDING and require COORDINATOR approval.
  const initialStatus =
    userRole === 'OPERATOR' || userRole === 'ADMIN' ? 'APPROVED' : 'PENDING';

  const incident = await prisma.incident.create({
    data: {
      title: input.title,
      description: input.description,
      severity: input.severity as PrismaIncidentSeverity,
      affectedPeople: input.affectedPeople,
      latitude: input.latitude,
      longitude: input.longitude,
      timeSensitivity: input.timeSensitivity,
      environmentalCondition: input.environmentalCondition ?? null,
      resourceRequirements: input.resourceRequirements,
      createdById: userId,
      status: initialStatus as PrismaIncidentStatus,
    },
    include: incidentInclude,
  });

  // Publish INCIDENT_CREATED via outbox — the event worker calculates priority
  // asynchronously (avoids blocking the response and duplicate calculation).
  await writeOutboxEventDirect(
    createEvent(EventType.INCIDENT_CREATED, {
      incidentId:  incident.id,
      severity:    incident.severity as string,
      status:      incident.status as string,
      createdById: incident.createdById,
    }),
  );

  return incident;
};

// ─── List ─────────────────────────────────────────────────────────────────────

export const getIncidents = async (
  filters: IncidentFilters,
  sort?: string,
  pagination?: PaginationParams,
  user?: AuthUser,
) => {
  const where: Record<string, unknown> = {};

  if (filters.status) where['status'] = filters.status;
  if (filters.severity) where['severity'] = filters.severity;

  // Role-based filtering
  if (user) {
    if (user.role === 'CITIZEN') {
      // Citizens only see their own incidents
      where['createdById'] = user.userId;
    } else if (user.role === 'OPERATOR') {
      // Operators only see incidents assigned to their resources
      const assignments = await prisma.assignment.findMany({
        where: {
          status: 'ACTIVE',
          resource: { operatorId: user.userId },
        },
        select: { incidentId: true },
      });
      const incidentIds = assignments.map((a) => a.incidentId);
      if (incidentIds.length === 0) {
        // No assigned incidents — return empty result
        where['id'] = { in: [] };
      } else {
        where['id'] = { in: incidentIds };
      }
    }
  }

  if (sort === 'priority' && !filters.status) {
    where['status'] = { notIn: ['COMPLETED', 'CANCELLED'] };
  }

  const orderBy =
    sort === 'priority'
      ? [{ priorityScore: 'desc' as const }, { createdAt: 'desc' as const }]
      : [{ severity: 'desc' as const }, { createdAt: 'desc' as const }];

  const { skip, take } = buildPaginationMeta(pagination ?? { page: 1, limit: 20 });
  const [total, items] = await Promise.all([
    prisma.incident.count({ where }),
    prisma.incident.findMany({
      where,
      orderBy,
      skip,
      take,
      include: incidentInclude,
    }),
  ]);

  const result: PaginatedResult<typeof items[number]> = {
    data: items,
    pagination: {
      page: pagination?.page ?? 1,
      limit: pagination?.limit ?? 20,
      total,
      totalPages: Math.ceil(total / (pagination?.limit ?? 20)),
      hasNextPage: (pagination?.page ?? 1) * (pagination?.limit ?? 20) < total,
      hasPrevPage: (pagination?.page ?? 1) > 1,
    },
  };
  return result;
};

// ─── Single ───────────────────────────────────────────────────────────────────

export const getIncidentById = async (id: string) => {
  const incident = await prisma.incident.findUnique({
    where: { id },
    include: incidentInclude,
  });
  if (!incident) {
    throw new AppError('Incident not found.', httpStatus.NOT_FOUND);
  }
  return incident;
};

// ─── Update ───────────────────────────────────────────────────────────────────

export const updateIncident = async (
  id: string,
  input: UpdateIncidentInput,
  userId: string,
  userRole: string,
) => {
  const incident = await prisma.incident.findUnique({ where: { id } });
  if (!incident) {
    throw new AppError('Incident not found.', httpStatus.NOT_FOUND);
  }

  if (userRole === 'CITIZEN') {
    if (incident.createdById !== userId) {
      throw new AppError('You can only modify your own incidents.', httpStatus.FORBIDDEN);
    }
    if (incident.status !== 'PENDING') {
      throw new AppError('You can only edit incidents that are still pending.', httpStatus.FORBIDDEN);
    }
  }
  if (userRole === 'OPERATOR') {
    throw new AppError('Operators do not have general incident editing permission.', httpStatus.FORBIDDEN);
  }

  const updated = await prisma.incident.update({
    where: { id },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.severity !== undefined && { severity: input.severity }),
      ...(input.affectedPeople !== undefined && { affectedPeople: input.affectedPeople }),
      ...(input.latitude !== undefined && { latitude: input.latitude }),
      ...(input.longitude !== undefined && { longitude: input.longitude }),
      ...(input.timeSensitivity !== undefined && { timeSensitivity: input.timeSensitivity }),
      ...(input.environmentalCondition !== undefined && { environmentalCondition: input.environmentalCondition }),
      ...(input.resourceRequirements !== undefined && { resourceRequirements: input.resourceRequirements }),
    },
    include: incidentInclude,
  });

  // Publish INCIDENT_UPDATED event
  await writeOutboxEventDirect(
    createEvent(EventType.INCIDENT_UPDATED, {
      incidentId:    updated.id,
      updatedFields: Object.keys(input).filter((k) => input[k as keyof UpdateIncidentInput] !== undefined),
    }),
  );

  if (touchesPriorityFields(input)) {
    await calculateAndSaveIncidentPriority(updated.id);
  }

  return updated;
};

// ─── Get incident assignments ─────────────────────────────────────────────────

/**
 * Returns all assignments for a given incident.
 * Used by CITIZEN to track their report's response progress.
 */
export const getIncidentAssignments = async (id: string) => {
  const incident = await prisma.incident.findUnique({ where: { id } });
  if (!incident) {
    throw new AppError('Incident not found.', httpStatus.NOT_FOUND);
  }

  return prisma.assignment.findMany({
    where: { incidentId: id },
    orderBy: { assignedAt: 'desc' },
    select: {
      id: true,
      status: true,
      assignedAt: true,
      releasedAt: true,
      resource: {
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
        },
      },
    },
  });
};

// ─── Cancel (Citizen self-cancel or Admin/Coordinator cancel) ─────────────────

/**
 * CITIZEN: can cancel only their own PENDING incident.
 * ADMIN / COORDINATOR: can cancel any incident that is not already COMPLETED or CANCELLED.
 */
export const cancelIncident = async (
  id: string,
  userId: string,
  userRole: string,
) => {
  const incident = await prisma.incident.findUnique({ where: { id } });
  if (!incident) {
    throw new AppError('Incident not found.', httpStatus.NOT_FOUND);
  }

  if (userRole === 'CITIZEN') {
    // Citizens can only cancel their own incident
    if (incident.createdById !== userId) {
      throw new AppError(
        'You can only cancel your own incidents.',
        httpStatus.FORBIDDEN,
      );
    }
    // Citizens can only cancel PENDING incidents (business rule)
    if (incident.status !== 'PENDING') {
      throw new AppError(
        'You can only cancel incidents that are still pending.',
        httpStatus.FORBIDDEN,
      );
    }
  } else {
    // ADMIN / COORDINATOR — cannot cancel already completed/cancelled
    const statusStr = incident.status as string;
    if (statusStr === 'COMPLETED' || statusStr === 'CANCELLED') {
      throw new AppError(
        `Incident is already ${incident.status.toLowerCase()} and cannot be cancelled.`,
        httpStatus.BAD_REQUEST,
      );
    }
  }

  return prisma.incident.update({
    where: { id },
    data: { status: 'CANCELLED' },
    include: incidentInclude,
  });
};

// ─── Approve (COORDINATOR/ADMIN) ─────────────────────────────────────────────

/**
 * COORDINATOR/ADMIN approves a CITIZEN-created PENDING incident.
 * PENDING → APPROVED
 * After this, resource assignment can begin.
 */
export const approveIncident = async (id: string) => {
  const incident = await prisma.incident.findUnique({
    where: { id },
    include: { createdBy: { select: { role: true } } },
  });
  if (!incident) {
    throw new AppError('Incident not found.', httpStatus.NOT_FOUND);
  }
  if (incident.status !== 'PENDING') {
    throw new AppError(
      `Cannot approve an incident with status "${incident.status}". Only PENDING incidents can be approved.`,
      httpStatus.BAD_REQUEST,
    );
  }
  // OPERATOR/ADMIN-created incidents are already APPROVED — no manual action needed.
  if (incident.createdBy.role !== 'CITIZEN') {
    throw new AppError(
      'This incident was created by an OPERATOR or ADMIN and was auto-approved on creation.',
      httpStatus.BAD_REQUEST,
    );
  }
  return prisma.incident.update({
    where: { id },
    data: { status: 'APPROVED' as PrismaIncidentStatus },
    include: incidentInclude,
  });
};

// ─── Reject (COORDINATOR/ADMIN) ───────────────────────────────────────────────

/**
 * COORDINATOR/ADMIN rejects a CITIZEN-created PENDING incident.
 * PENDING → REJECTED
 * No resource assignment or operational action will follow.
 */
export const rejectIncident = async (id: string, reason?: string) => {
  const incident = await prisma.incident.findUnique({
    where: { id },
    include: { createdBy: { select: { role: true } } },
  });
  if (!incident) {
    throw new AppError('Incident not found.', httpStatus.NOT_FOUND);
  }
  if (incident.status !== 'PENDING') {
    throw new AppError(
      `Cannot reject an incident with status "${incident.status}". Only PENDING incidents can be rejected.`,
      httpStatus.BAD_REQUEST,
    );
  }
  return prisma.incident.update({
    where: { id },
    data: {
      status: 'REJECTED' as PrismaIncidentStatus,
      ...(reason && { environmentalCondition: `REJECTED: ${reason}` }),
    },
    include: incidentInclude,
  });
};

// ─── Status change ────────────────────────────────────────────────────────────

export const updateIncidentStatus = async (
  id: string,
  input: UpdateStatusInput,
) => {
  const incident = await prisma.incident.findUnique({ where: { id } });
  if (!incident) {
    throw new AppError('Incident not found.', httpStatus.NOT_FOUND);
  }

  const currentStatus = incident.status as IncidentStatus;
  const nextStatus = input.status as IncidentStatus;
  const allowed = ALLOWED_STATUS_TRANSITIONS[currentStatus];

  if (!allowed.includes(nextStatus)) {
    throw new AppError(
      `Invalid status transition: "${currentStatus}" → "${nextStatus}". Allowed: [${allowed.join(', ') || 'none'}].`,
      httpStatus.BAD_REQUEST,
    );
  }

  return prisma.incident.update({
    where: { id },
    data: { status: nextStatus as PrismaIncidentStatus },
    include: incidentInclude,
  });
};
