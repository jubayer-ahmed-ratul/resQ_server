/**
 * Resource Service — Part 12 updated
 *
 * Changes from Part 10:
 *   - Added cache-aside pattern for getResources() and getResourceById()
 *   - Cache invalidation on update (status change, any field change)
 *   - Added pagination support to getResources()
 *   - Only fields actually needed are selected (avoids SELECT *)
 *
 * Caching strategy:
 *   resource:list — full list with filters (TTL: CACHE_DEFAULT_TTL_SECONDS)
 *   resource:{id}  — individual resource (TTL: CACHE_DEFAULT_TTL_SECONDS)
 *
 * Invalidation:
 *   On any resource update → del resource:{id} + del resource:list
 *   This is a safe strategy because resource data is relatively small and
 *   read-heavy (resource listing is called for every allocation decision).
 *
 * IMPORTANT: Assignment decisions always re-read resource status from DB
 *   inside the transaction. The cache is only used for listing/display.
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

export const createResource = async (input: CreateResourceInput) => {
  const resource = await prisma.resource.create({ data: input });

  // Invalidate list cache on new resource creation
  const cache = getCacheService();
  await cache.del(CacheKeys.RESOURCE_LIST);

  return resource;
};

export const getResources = async (
  filters: ResourceFilters,
  pagination: PaginationParams,
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

  if (isDefaultQuery) {
    const cached = await cache.get<PaginatedResult<unknown>>(CacheKeys.RESOURCE_LIST);
    if (cached) {
      return cached;
    }
  }

  const where: Record<string, unknown> = {};
  if (filters.type) where['type'] = filters.type;
  if (filters.status) where['status'] = filters.status;

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

  if (isDefaultQuery) {
    await cache.set(CacheKeys.RESOURCE_LIST, result);
  }

  return result;
};

export const getResourceById = async (id: string) => {
  const cache = getCacheService();
  const cacheKey = CacheKeys.RESOURCE_BY_ID(id);

  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource) {
    throw new AppError('Resource not found.', httpStatus.NOT_FOUND);
  }

  await cache.set(cacheKey, resource);
  return resource;
};

export const updateResource = async (
  id: string,
  input: UpdateResourceInput,
) => {
  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource) {
    throw new AppError('Resource not found.', httpStatus.NOT_FOUND);
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
