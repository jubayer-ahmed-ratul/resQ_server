/**
 * Resource Service — Part 12 updated + RBAC
 *
 * Changes from Part 10:
 *   - Added cache-aside pattern for getResources() and getResourceById()
 *   - Cache invalidation on update (status change, any field change)
 *   - Added pagination support to getResources()
 *   - Only fields actually needed are selected (avoids SELECT *)
 *   - RBAC: OPERATOR sees only their assigned resources
 *   - RBAC: OPERATOR can only update status/location of their assigned resource
 *   - RBAC: ADMIN can assign/remove operators
 */

import httpStatus from 'http-status';
import prisma from '../../lib/prisma';
import { AppError } from '../../utils/errors';
import {
  CreateResourceInput,
  UpdateResourceInput,
  ResourceFilters,
} from './resource.interface';
import { createEvent } from '../../events/event.publisher';
import { EventType } from '../../events/event.types';
import { writeOutboxEventDirect } from '../../events/outbox/outbox.helper';
import { getCacheService } from '../../cache/cache.service';
import { CacheKeys } from '../../cache/cache.interface';
import config from '../../config';
import { PaginationParams, PaginatedResult, buildPaginationMeta } from '../../utils/pagination';
import { AuthUser } from '../../middlewares/auth';

export const createResource = async (input: CreateResourceInput) => {
  const resource = await prisma.resource.create({
    data: {
      name: input.name,
      type: input.type,
      latitude: input.latitude,
      longitude: input.longitude,
      capacity: input.capacity,
      ...(input.status !== undefined && { status: input.status }),
      ...(input.operatorId !== undefined && { operatorId: input.operatorId }),
    },
  });

  // Invalidate list cache on new resource creation
  const cache = getCacheService();
  await cache.del(CacheKeys.RESOURCE_LIST);

  return resource;
};

export const getResources = async (
  filters: ResourceFilters,
  pagination: PaginationParams,
  user: AuthUser,
) => {
  const cache = getCacheService();

  // Build a deterministic cache key that includes filters and pagination
  // Only cache the first page with no filters (most common case)
  // Filtered/paginated views skip cache to avoid unbounded key space
  const isDefaultQuery =
    !filters.type &&
    !filters.status &&
    pagination.page === 1 &&
    pagination.limit === config.pagination.defaultLimit;

  if (isDefaultQuery && user.role !== 'OPERATOR') {
    const cached = await cache.get<PaginatedResult<unknown>>(CacheKeys.RESOURCE_LIST);
    if (cached) {
      return cached;
    }
  }

  const where: Record<string, unknown> = {};
  if (filters.type) where['type'] = filters.type;
  if (filters.status) where['status'] = filters.status;

  // OPERATOR: only see their assigned resources
  if (user.role === 'OPERATOR') {
    where['operatorId'] = user.userId;
  }

  const { skip, take } = buildPaginationMeta(pagination);

  const [total, items] = await Promise.all([
    prisma.resource.count({ where }),
    prisma.resource.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        capacity: true,
        latitude: true,
        longitude: true,
        operatorId: true,
        createdAt: true,
        updatedAt: true,
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

  if (isDefaultQuery && user.role !== 'OPERATOR') {
    await cache.set(CacheKeys.RESOURCE_LIST, result);
  }

  return result;
};

export const getResourceById = async (id: string) => {
  const cache = getCacheService();
  const cacheKey = CacheKeys.RESOURCE_BY_ID(id);

  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const resource = await prisma.resource.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      capacity: true,
      latitude: true,
      longitude: true,
      operatorId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!resource) {
    throw new AppError('Resource not found.', httpStatus.NOT_FOUND);
  }

  await cache.set(cacheKey, resource);
  return resource;
};

export const updateResource = async (
  id: string,
  input: UpdateResourceInput,
  user: AuthUser,
) => {
  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource) {
    throw new AppError('Resource not found.', httpStatus.NOT_FOUND);
  }

  // OPERATOR: can only update status/location of their assigned resource
  if (user.role === 'OPERATOR') {
    if (resource.operatorId !== user.userId) {
      throw new AppError(
        'You do not have permission to update this resource.',
        httpStatus.FORBIDDEN,
      );
    }
    // Only allow status and location updates for OPERATOR
    const allowedFields = ['status', 'latitude', 'longitude'];
    const requestedFields = Object.keys(input);
    const disallowed = requestedFields.filter((f) => !allowedFields.includes(f));
    if (disallowed.length > 0) {
      throw new AppError(
        `Operators can only update: ${allowedFields.join(', ')}.`,
        httpStatus.FORBIDDEN,
      );
    }
  }

  const updated = await prisma.resource.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.type !== undefined && { type: input.type }),
      ...(input.latitude !== undefined && { latitude: input.latitude }),
      ...(input.longitude !== undefined && { longitude: input.longitude }),
      ...(input.capacity !== undefined && { capacity: input.capacity }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.operatorId !== undefined && { operatorId: input.operatorId }),
    },
  });

  // Invalidate cache: individual resource + resource list
  const cache = getCacheService();
  await cache.del(CacheKeys.RESOURCE_BY_ID(id), CacheKeys.RESOURCE_LIST);

  // Publish RESOURCE_STATUS_CHANGED when status changes
  if (input.status !== undefined && input.status !== resource.status) {
    const previousStatus = resource.status as string;
    const newStatus = updated.status as string;

    await writeOutboxEventDirect(
      createEvent(EventType.RESOURCE_STATUS_CHANGED, {
        resourceId:     updated.id,
        resourceName:   updated.name,
        previousStatus,
        newStatus,
      }),
    );

    // Also publish RESOURCE_FAILURE_DETECTED for immediate triage
    if (newStatus === 'FAILED') {
      // Find active assignment for this resource (if any)
      const activeAssignment = await prisma.assignment.findFirst({
        where: { resourceId: id, status: 'ACTIVE' },
        select: { id: true },
      });

      await writeOutboxEventDirect(
        createEvent(EventType.RESOURCE_FAILURE_DETECTED, {
          resourceId:          updated.id,
          resourceName:        updated.name,
          activeAssignmentId:  activeAssignment?.id,
        }),
      );
    }
  }

  return updated;
};

/**
 * Assign an Operator to a resource — ADMIN only.
 */
export const assignOperator = async (id: string, operatorId: string) => {
  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource) {
    throw new AppError('Resource not found.', httpStatus.NOT_FOUND);
  }

  // Verify the operator exists and has OPERATOR role
  const operator = await prisma.user.findUnique({ where: { id: operatorId } });
  if (!operator) {
    throw new AppError('Operator not found.', httpStatus.NOT_FOUND);
  }
  if (operator.role !== 'OPERATOR') {
    throw new AppError('The specified user is not an OPERATOR.', httpStatus.BAD_REQUEST);
  }

  const updated = await prisma.resource.update({
    where: { id },
    data: { operatorId },
  });

  const cache = getCacheService();
  await cache.del(CacheKeys.RESOURCE_BY_ID(id), CacheKeys.RESOURCE_LIST);

  return updated;
};

/**
 * Remove the Operator from a resource — ADMIN only.
 */
export const removeOperator = async (id: string) => {
  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource) {
    throw new AppError('Resource not found.', httpStatus.NOT_FOUND);
  }

  const updated = await prisma.resource.update({
    where: { id },
    data: { operatorId: null },
  });

  const cache = getCacheService();
  await cache.del(CacheKeys.RESOURCE_BY_ID(id), CacheKeys.RESOURCE_LIST);

  return updated;
};

/**
 * Deactivate (soft-delete) a resource — ADMIN only.
 * Sets status to UNAVAILABLE so it no longer appears in allocation queries.
 */
export const deactivateResource = async (id: string) => {
  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource) {
    throw new AppError('Resource not found.', httpStatus.NOT_FOUND);
  }

  const updated = await prisma.resource.update({
    where: { id },
    data: { status: 'UNAVAILABLE' },
  });

  const cache = getCacheService();
  await cache.del(CacheKeys.RESOURCE_BY_ID(id), CacheKeys.RESOURCE_LIST);

  return updated;
};