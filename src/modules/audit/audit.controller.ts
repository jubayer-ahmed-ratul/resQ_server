import { Request, Response } from 'express';
import httpStatus from 'http-status';
import * as auditService from './audit.service';
import sendResponse from '../../utils/sendResponse';
import { AuditLogFilters } from './audit.interface';
import { parsePagination } from '../../utils/pagination';

// Entities a COORDINATOR is allowed to see in audit logs
const COORDINATOR_ALLOWED_ENTITIES = ['INCIDENT', 'ASSIGNMENT'];

export const getAuditLogs = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userRole = req.user!.role;

  const filters: AuditLogFilters = {
    ...(req.query['actorId'] && { actorId: req.query['actorId'] as string }),
    ...(req.query['entity'] && { entity: req.query['entity'] as string }),
    ...(req.query['entityId'] && { entityId: req.query['entityId'] as string }),
  };

  // COORDINATOR gets limited access — only INCIDENT and ASSIGNMENT audit logs.
  // They cannot request logs for other entities (USER, RESOURCE, HOSPITAL, etc.).
  if (userRole === 'COORDINATOR') {
    if (filters.entity && !COORDINATOR_ALLOWED_ENTITIES.includes(filters.entity.toUpperCase())) {
      sendResponse({
        res,
        statusCode: httpStatus.FORBIDDEN,
        success: false,
        message: `Coordinators can only view audit logs for: ${COORDINATOR_ALLOWED_ENTITIES.join(', ')}.`,
        data: null,
      });
      return;
    }
    // If no entity filter specified, restrict to allowed entities only
    if (!filters.entity) {
      filters.entityFilter = COORDINATOR_ALLOWED_ENTITIES;
    }
  }

  const pagination = parsePagination(req);
  const result = await auditService.getAuditLogs(filters, pagination);

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Audit logs retrieved successfully.',
    data: result,
  });
};