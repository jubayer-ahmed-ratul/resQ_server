import httpStatus from 'http-status';
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

// ─── Create ───────────────────────────────────────────────────────────────────

export const createIncident = async (
  input: CreateIncidentInput,
  userId: string,
) => {
  const incident = await prisma.incident.create({
    data: {
      title: input.title,
      description: input.description,
      severity: input.severity,
      affectedPeople: input.affectedPeople,
      latitude: input.latitude,
      longitude: input.longitude,
      timeSensitivity: input.timeSensitivity,
      environmentalCondition: input.environmentalCondition ?? null,
      resourceRequirements: input.resourceRequirements,
      createdById: userId,
    },
  });

  // Publish INCIDENT_CREATED via outbox (atomic enough — created before priority calc)
  // Priority calculation is intentionally synchronous here so the HTTP response
  // includes the score. The INCIDENT_CREATED event allows async downstream consumers
  // to react independently without re-doing the calculation.
  await writeOutboxEventDirect(
    createEvent(EventType.INCIDENT_CREATED, {
      incidentId:  incident.id,
      severity:    incident.severity as string,
      status:      incident.status as string,
      createdById: incident.createdById,
    }),
  );

  // Calculate and persist priority score (synchronous — included in response)
  await calculateAndSaveIncidentPriority(incident.id);

  return prisma.incident.findUnique({
    where: { id: incident.id },
    include: {
      createdBy: {
        select: { id: true, name: true, email: true, role: true },
      },
    },
  });
};

// ─── List ─────────────────────────────────────────────────────────────────────

export const getIncidents = async (
  filters: IncidentFilters,
  sort?: string,
  pagination?: PaginationParams,
) => {
  const where: Record<string, unknown> = {};

  if (filters.status) where['status'] = filters.status;
  if (filters.severity) where['severity'] = filters.severity;

  if (sort === 'priority') {
    if (!filters.status) {
      where['status'] = { notIn: ['RESOLVED', 'CANCELLED'] };
    }
  }

  const orderBy =
    sort === 'priority'
      ? [{ priorityScore: 'desc' as const }, { createdAt: 'desc' as const }]
      : [{ severity: 'desc' as const }, { createdAt: 'desc' as const }];

  // If pagination provided, return paginated result
  if (pagination) {
    const { skip, take } = buildPaginationMeta(pagination);
    const [total, items] = await Promise.all([
      prisma.incident.count({ where }),
      prisma.incident.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          createdBy: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
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

  // Legacy non-paginated path (kept for backward compatibility with internal callers)
  return prisma.incident.findMany({
    where,
    orderBy,
    include: {
      createdBy: {
        select: { id: true, name: true, email: true, role: true },
      },
    },
  });
};

// ─── Single ───────────────────────────────────────────────────────────────────

export const getIncidentById = async (id: string) => {
  const incident = await prisma.incident.findUnique({
    where: { id },
    include: {
      createdBy: {
        select: { id: true, name: true, email: true, role: true },
      },
    },
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

  return prisma.incident.findUnique({
    where: { id: updated.id },
    include: { createdBy: { select: { id: true, name: true, email: true, role: true } } },
  });
};

// ─── Validate ─────────────────────────────────────────────────────────────────

export const validateIncident = async (id: string) => {
  const incident = await prisma.incident.findUnique({ where: { id } });
  if (!incident) {
    throw new AppError('Incident not found.', httpStatus.NOT_FOUND);
  }
  if (incident.status !== 'PENDING') {
    throw new AppError(
      `Cannot validate an incident with status "${incident.status}". Only PENDING incidents can be validated.`,
      httpStatus.BAD_REQUEST,
    );
  }
  return prisma.incident.update({
    where: { id },
    data: { status: 'VALIDATED' },
    include: { createdBy: { select: { id: true, name: true, email: true, role: true } } },
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
  const nextStatus = input.status;
  const allowed = ALLOWED_STATUS_TRANSITIONS[currentStatus];

  if (!allowed.includes(nextStatus)) {
    throw new AppError(
      `Invalid status transition: "${currentStatus}" → "${nextStatus}". Allowed: [${allowed.join(', ') || 'none'}].`,
      httpStatus.BAD_REQUEST,
    );
  }

  return prisma.incident.update({
    where: { id },
    data: { status: nextStatus },
    include: { createdBy: { select: { id: true, name: true, email: true, role: true } } },
  });
};
