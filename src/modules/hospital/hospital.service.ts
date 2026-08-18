/**
 * Hospital Service — Part 12 updated
 *
 * Changes from Part 10:
 *   - Added cache-aside pattern for getHospitals() and getHospitalById()
 *   - Cache invalidation on update (capacity/status changes)
 *   - hospital:{id}:availability key for availability-specific reads
 *   - Added pagination support to getHospitals()
 *
 * Caching strategy:
 *   hospital:list              — paginated list (TTL: CACHE_DEFAULT_TTL_SECONDS)
 *   hospital:{id}              — individual hospital (TTL: CACHE_DEFAULT_TTL_SECONDS)
 *   hospital:{id}:availability — availability subset (TTL: half of default TTL)
 *
 * Invalidation:
 *   On hospital update → del hospital:{id} + hospital:{id}:availability + hospital:list
 *
 * IMPORTANT: Hospital capacity is cached for display purposes.
 *   Resource allocation and clinical decisions must re-read from DB directly.
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

export const createHospital = async (input: CreateHospitalInput) => {
  const hospital = await prisma.hospital.create({ data: input });

  // Invalidate list cache
  const cache = getCacheService();
  await cache.del(CacheKeys.HOSPITAL_LIST);

  return hospital;
};

export const getHospitals = async (
  filters: HospitalFilters,
  pagination: PaginationParams,
) => {
  const cache = getCacheService();

  // Only cache the default (no-filter) first-page query
  const isDefaultQuery =
    !filters.status &&
    pagination.page === 1 &&
    pagination.limit === config.pagination.defaultLimit;

  if (isDefaultQuery) {
    const cached = await cache.get<PaginatedResult<unknown>>(CacheKeys.HOSPITAL_LIST);
    if (cached) {
      return cached;
    }
  }

  const where: Record<string, unknown> = {};
  if (filters.status) where['status'] = filters.status;

  const { skip, take } = buildPaginationMeta(pagination);

  const [total, items] = await Promise.all([
    prisma.hospital.count({ where }),
    prisma.hospital.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
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
    await cache.set(CacheKeys.HOSPITAL_LIST, result);
  }

  return result;
};

export const getHospitalById = async (id: string) => {
  const cache = getCacheService();
  const cacheKey = CacheKeys.HOSPITAL_BY_ID(id);

  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const hospital = await prisma.hospital.findUnique({ where: { id } });
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
) => {
  const hospital = await prisma.hospital.findUnique({ where: { id } });
  if (!hospital) {
    throw new AppError('Hospital not found.', httpStatus.NOT_FOUND);
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
    },
  });

  // Invalidate all hospital-related cache keys
  const cache = getCacheService();
  await cache.del(
    CacheKeys.HOSPITAL_BY_ID(id),
    CacheKeys.HOSPITAL_AVAILABILITY(id),
    CacheKeys.HOSPITAL_LIST,
  );

  return updated;
};
