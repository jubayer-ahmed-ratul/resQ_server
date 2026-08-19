/**
 * Hospital Service — Part 12 updated + RBAC
 *
 * Changes from Part 10:
 *   - Added cache-aside pattern for getHospitals() and getHospitalById()
 *   - Cache invalidation on update (capacity/status changes)
 *   - hospital:{id}:availability key for availability-specific reads
 *   - Added pagination support to getHospitals()
 *   - RBAC: OPERATOR sees only their assigned hospital
 *   - RBAC: OPERATOR can only update capacity/status of their assigned hospital
 *   - RBAC: ADMIN can assign/remove operators
 */

import httpStatus from 'http-status';
import prisma from '../../lib/prisma';
import { AppError } from '../../utils/errors';
import {
  CreateHospitalInput,
  UpdateHospitalInput,
  HospitalFilters,
} from './hospital.interface';
import { getCacheService } from '../../cache/cache.service';
import { CacheKeys } from '../../cache/cache.interface';
import config from '../../config';
import { PaginationParams, PaginatedResult, buildPaginationMeta } from '../../utils/pagination';
import { AuthUser } from '../../middlewares/auth';

export const createHospital = async (input: CreateHospitalInput) => {
  const hospital = await prisma.hospital.create({
    data: {
      name: input.name,
      latitude: input.latitude,
      longitude: input.longitude,
      bedCapacity: input.bedCapacity,
      availableBeds: input.availableBeds,
      icuCapacity: input.icuCapacity,
      availableICUBeds: input.availableICUBeds,
      ...(input.status !== undefined && { status: input.status }),
      ...(input.assignedOperatorId !== undefined && { assignedOperatorId: input.assignedOperatorId }),
    },
  });

  // Invalidate list cache
  const cache = getCacheService();
  await cache.del(CacheKeys.HOSPITAL_LIST);
  await cache.delPattern('hospital:list:*');

  return hospital;
};

export const getHospitals = async (
  filters: HospitalFilters,
  pagination: PaginationParams,
  user: AuthUser,
) => {
  const cache = getCacheService();

  // Build a deterministic cache key from all query params
  // Skip cache for OPERATOR (they see filtered data by userId — not safe to share)
  const cacheKey = CacheKeys.HOSPITAL_LIST_QUERY(
    `s:${filters.status ?? ''}_p:${pagination.page}_l:${pagination.limit}`,
  );

  if (user.role !== 'OPERATOR') {
    const cached = await cache.get<PaginatedResult<unknown>>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const where: Record<string, unknown> = {};
  if (filters.status) where['status'] = filters.status;

  // OPERATOR: only see their assigned hospital
  if (user.role === 'OPERATOR') {
    where['assignedOperatorId'] = user.userId;
  }

  const { skip, take } = buildPaginationMeta(pagination);

  const [total, items] = await Promise.all([
    prisma.hospital.count({ where }),
    prisma.hospital.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        bedCapacity: true,
        availableBeds: true,
        icuCapacity: true,
        availableICUBeds: true,
        status: true,
        assignedOperatorId: true,
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

  if (user.role !== 'OPERATOR') {
    // Hospital data changes infrequently — cache for 5 minutes
    await cache.set(cacheKey, result, 300);
  }

  return result;
};

export const getHospitalById = async (id: string) => {
  const cache = getCacheService();
  const cacheKey = CacheKeys.HOSPITAL_BY_ID(id);

  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const hospital = await prisma.hospital.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      latitude: true,
      longitude: true,
      bedCapacity: true,
      availableBeds: true,
      icuCapacity: true,
      availableICUBeds: true,
      status: true,
      assignedOperatorId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!hospital) {
    throw new AppError('Hospital not found.', httpStatus.NOT_FOUND);
  }

  await cache.set(cacheKey, hospital);
  return hospital;
};

export const getHospitalAvailability = async (id: string) => {
  const cache = getCacheService();
  const cacheKey = CacheKeys.HOSPITAL_AVAILABILITY(id);

  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const hospital = await prisma.hospital.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      status: true,
      bedCapacity: true,
      availableBeds: true,
      icuCapacity: true,
      availableICUBeds: true,
    },
  });

  if (!hospital) {
    throw new AppError('Hospital not found.', httpStatus.NOT_FOUND);
  }

  // Availability TTL is half the default to refresh more frequently
  const ttl = Math.max(1, Math.floor(config.cache.defaultTtlSeconds / 2));
  await cache.set(cacheKey, hospital, ttl);
  return hospital;
};

export const updateHospital = async (
  id: string,
  input: UpdateHospitalInput,
  user: AuthUser,
) => {
  const hospital = await prisma.hospital.findUnique({ where: { id } });
  if (!hospital) {
    throw new AppError('Hospital not found.', httpStatus.NOT_FOUND);
  }

  // OPERATOR: can only update capacity/status of their assigned hospital
  if (user.role === 'OPERATOR') {
    if (hospital.assignedOperatorId !== user.userId) {
      throw new AppError(
        'You do not have permission to update this hospital.',
        httpStatus.FORBIDDEN,
      );
    }
    // Only allow capacity and status updates for OPERATOR
    const allowedFields = ['status', 'availableBeds', 'availableICUBeds', 'bedCapacity', 'icuCapacity'];
    const requestedFields = Object.keys(input);
    const disallowed = requestedFields.filter((f) => !allowedFields.includes(f));
    if (disallowed.length > 0) {
      throw new AppError(
        `Operators can only update: ${allowedFields.join(', ')}.`,
        httpStatus.FORBIDDEN,
      );
    }
  }

  // Determine final values after potential update to enforce capacity rules
  const finalBedCapacity = input.bedCapacity ?? hospital.bedCapacity;
  const finalAvailableBeds = input.availableBeds ?? hospital.availableBeds;
  const finalIcuCapacity = input.icuCapacity ?? hospital.icuCapacity;
  const finalAvailableICUBeds =
    input.availableICUBeds ?? hospital.availableICUBeds;

  if (finalAvailableBeds > finalBedCapacity) {
    throw new AppError(
      `availableBeds (${finalAvailableBeds}) cannot exceed bedCapacity (${finalBedCapacity}).`,
      httpStatus.BAD_REQUEST,
    );
  }

  if (finalAvailableICUBeds > finalIcuCapacity) {
    throw new AppError(
      `availableICUBeds (${finalAvailableICUBeds}) cannot exceed icuCapacity (${finalIcuCapacity}).`,
      httpStatus.BAD_REQUEST,
    );
  }

  const updated = await prisma.hospital.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.latitude !== undefined && { latitude: input.latitude }),
      ...(input.longitude !== undefined && { longitude: input.longitude }),
      ...(input.bedCapacity !== undefined && { bedCapacity: input.bedCapacity }),
      ...(input.availableBeds !== undefined && { availableBeds: input.availableBeds }),
      ...(input.icuCapacity !== undefined && { icuCapacity: input.icuCapacity }),
      ...(input.availableICUBeds !== undefined && { availableICUBeds: input.availableICUBeds }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.assignedOperatorId !== undefined && { assignedOperatorId: input.assignedOperatorId }),
    },
  });

  // Invalidate all hospital-related cache keys
  const cache = getCacheService();
  await cache.del(
    CacheKeys.HOSPITAL_BY_ID(id),
    CacheKeys.HOSPITAL_AVAILABILITY(id),
    CacheKeys.HOSPITAL_LIST,
  );
  await cache.delPattern('hospital:list:*');

  return updated;
};

/**
 * Assign an Operator to a hospital — ADMIN only.
 */
export const assignOperator = async (id: string, operatorId: string) => {
  const hospital = await prisma.hospital.findUnique({ where: { id } });
  if (!hospital) {
    throw new AppError('Hospital not found.', httpStatus.NOT_FOUND);
  }

  // Verify the operator exists and has OPERATOR role
  const operator = await prisma.user.findUnique({ where: { id: operatorId } });
  if (!operator) {
    throw new AppError('Operator not found.', httpStatus.NOT_FOUND);
  }
  if (operator.role !== 'OPERATOR') {
    throw new AppError('The specified user is not an OPERATOR.', httpStatus.BAD_REQUEST);
  }

  const updated = await prisma.hospital.update({
    where: { id },
    data: { assignedOperatorId: operatorId },
  });

  const cache = getCacheService();
  await cache.del(
    CacheKeys.HOSPITAL_BY_ID(id),
    CacheKeys.HOSPITAL_AVAILABILITY(id),
    CacheKeys.HOSPITAL_LIST,
  );
  await cache.delPattern('hospital:list:*');

  return updated;
};

/**
 * Remove the Operator from a hospital — ADMIN only.
 */
export const removeOperator = async (id: string) => {
  const hospital = await prisma.hospital.findUnique({ where: { id } });
  if (!hospital) {
    throw new AppError('Hospital not found.', httpStatus.NOT_FOUND);
  }

  const updated = await prisma.hospital.update({
    where: { id },
    data: { assignedOperatorId: null },
  });

  const cache = getCacheService();
  await cache.del(
    CacheKeys.HOSPITAL_BY_ID(id),
    CacheKeys.HOSPITAL_AVAILABILITY(id),
    CacheKeys.HOSPITAL_LIST,
  );
  await cache.delPattern('hospital:list:*');

  return updated;
};

/**
 * Deactivate (soft-delete) a hospital — ADMIN only.
 * Sets status to CLOSED so it no longer appears in active routing.
 */
export const deactivateHospital = async (id: string) => {
  const hospital = await prisma.hospital.findUnique({ where: { id } });
  if (!hospital) {
    throw new AppError('Hospital not found.', httpStatus.NOT_FOUND);
  }

  const updated = await prisma.hospital.update({
    where: { id },
    data: { status: 'CLOSED' },
  });

  const cache = getCacheService();
  await cache.del(
    CacheKeys.HOSPITAL_BY_ID(id),
    CacheKeys.HOSPITAL_AVAILABILITY(id),
    CacheKeys.HOSPITAL_LIST,
  );
  await cache.delPattern('hospital:list:*');

  return updated;
};