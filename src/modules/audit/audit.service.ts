import prisma from '../../lib/prisma';
import logger from '../../lib/logger';
import { AuditLogInput, AuditLogFilters } from './audit.interface';
import { PaginationParams, PaginatedResult, buildPaginationMeta } from '../../utils/pagination';

/**
 * Write an audit log entry. Fire-and-forget — never blocks the main flow.
 */
export const writeAuditLog = async (input: AuditLogInput): Promise<void> => {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        details: (input.details as object) ?? undefined,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (err) {
    // Audit logging must never break the main operation.
    // Log the failure but do not throw.
    logger.error('[Audit] Failed to write audit log', {
      operation: 'writeAuditLog',
      errorCode: 'DATABASE_ERROR',
      message: (err as Error).message,
    });
  }
};

/**
 * List audit logs.
 * ADMIN — all logs.
 * COORDINATOR — scoped to INCIDENT and ASSIGNMENT entities (enforced in controller via entityFilter).
 */
export const getAuditLogs = async (
  filters: AuditLogFilters,
  pagination: PaginationParams,
): Promise<PaginatedResult<unknown>> => {
  const where: Record<string, unknown> = {};
  if (filters.actorId) where['actorId'] = filters.actorId;
  if (filters.entityId) where['entityId'] = filters.entityId;

  // entity takes priority; entityFilter is a fallback scope restriction
  if (filters.entity) {
    where['entity'] = filters.entity;
  } else if (filters.entityFilter && filters.entityFilter.length > 0) {
    where['entity'] = { in: filters.entityFilter };
  }

  const { skip, take } = buildPaginationMeta(pagination);

  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        actor: { select: { id: true, name: true, email: true, role: true } },
      },
    }),
  ]);

  return {
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
};