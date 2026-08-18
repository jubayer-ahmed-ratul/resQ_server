/**
 * Pagination Utilities — Part 12
 *
 * Provides consistent pagination parsing and response shaping across
 * all list endpoints.
 *
 * Strategy: offset pagination (page + limit)
 *   - Simple to implement, works well for read-heavy emergency dashboards
 *   - Cursor pagination is better for real-time feeds (potential future upgrade)
 *
 * Limits:
 *   - Maximum page size enforced (default 100) to prevent DB overload
 *   - Default page size configurable via PAGINATION_DEFAULT_LIMIT
 *
 * URL format:
 *   GET /api/v1/incidents?page=1&limit=20
 *
 * Response:
 *   {
 *     data: [...],
 *     pagination: { page, limit, total, totalPages, hasNextPage, hasPrevPage }
 *   }
 */

import { Request } from 'express';
import config from '../config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationMeta;
}

// ─── Parse pagination from request query ─────────────────────────────────────

/**
 * parsePagination
 *
 * Safely extracts and validates page + limit from query string.
 * Defaults to page=1, limit=PAGINATION_DEFAULT_LIMIT.
 * Clamps limit to [1, PAGINATION_MAX_LIMIT].
 */
export function parsePagination(req: Request): PaginationParams {
  const defaultLimit = config.pagination.defaultLimit;
  const maxLimit = config.pagination.maxLimit;

  let page = 1;
  let limit = defaultLimit;

  const rawPage = req.query['page'];
  const rawLimit = req.query['limit'];

  if (typeof rawPage === 'string') {
    const parsed = parseInt(rawPage, 10);
    if (!isNaN(parsed) && parsed >= 1) {
      page = parsed;
    }
  }

  if (typeof rawLimit === 'string') {
    const parsed = parseInt(rawLimit, 10);
    if (!isNaN(parsed) && parsed >= 1) {
      limit = Math.min(parsed, maxLimit);
    }
  }

  return { page, limit };
}

// ─── Build Prisma skip/take from pagination params ────────────────────────────

export function buildPaginationMeta(params: PaginationParams): {
  skip: number;
  take: number;
} {
  return {
    skip: (params.page - 1) * params.limit,
    take: params.limit,
  };
}
