import { Request, Response } from 'express';
import httpStatus from 'http-status';
import * as incidentService from './incident.service';
import * as decisionService from '../decision/decision.service';
import sendResponse from '../../utils/sendResponse';
import {
  CreateIncidentInput,
  UpdateIncidentInput,
  UpdateStatusInput,
  IncidentFilters,
  IncidentStatus,
  IncidentSeverity,
} from './incident.interface';
import { parsePagination } from '../../utils/pagination';
import { writeAuditLog } from '../audit/audit.service';

/**
 * POST /api/incidents
 */
export const createIncident = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const input = req.body as CreateIncidentInput;
  const userId = req.user!.userId;
  const userRole = req.user!.role;

  const incident = await incidentService.createIncident(input, userId, userRole);

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'CREATE',
    entity: 'INCIDENT',
    entityId: incident.id,
    details: { title: incident.title, severity: incident.severity },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Incident created successfully.',
    data: incident,
  });
};

/**
 * GET /api/incidents
 * Role-based filtering:
 *   ADMIN/COORDINATOR — all incidents
 *   CITIZEN — only their own
 *   OPERATOR — only incidents assigned to their resource
 */
export const getIncidents = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const filters: IncidentFilters = {
    ...(req.query['status'] && {
      status: req.query['status'] as IncidentStatus,
    }),
    ...(req.query['severity'] && {
      severity: req.query['severity'] as IncidentSeverity,
    }),
  };

  const sort = req.query['sort'] as string | undefined;
  const pagination = parsePagination(req);
  const result = await incidentService.getIncidents(filters, sort, pagination, req.user!);

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Incidents retrieved successfully.',
    data: result,
  });
};

/**
 * GET /api/incidents/:id
 */
export const getIncidentById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const incident = await incidentService.getIncidentById(req.params['id']!);

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Incident retrieved successfully.',
    data: incident,
  });
};

/**
 * PATCH /api/incidents/:id
 */
export const updateIncident = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const input = req.body as UpdateIncidentInput;
  const userId = req.user!.userId;
  const userRole = req.user!.role;

  const incident = await incidentService.updateIncident(
    req.params['id']!,
    input,
    userId,
    userRole,
  );

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'UPDATE',
    entity: 'INCIDENT',
    entityId: incident.id,
    details: { updatedFields: Object.keys(req.body) },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Incident updated successfully.',
    data: incident,
  });
};

/**
 * PATCH /api/incidents/:id/validate
 */
export const validateIncident = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const incident = await incidentService.validateIncident(req.params['id']!);

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'APPROVE',
    entity: 'INCIDENT',
    entityId: incident.id,
    details: { status: 'VALIDATED' },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Incident validated successfully.',
    data: incident,
  });
};

/**
 * PATCH /api/incidents/:id/status
 */
export const updateIncidentStatus = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const input = req.body as UpdateStatusInput;

  const incident = await incidentService.updateIncidentStatus(
    req.params['id']!,
    input,
  );

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'UPDATE',
    entity: 'INCIDENT',
    entityId: incident.id,
    details: { status: input.status },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Incident status updated successfully.',
    data: incident,
  });
};

/**
 * POST /api/incidents/:id/calculate-priority
 * ADMIN / COORDINATOR only
 */
export const calculatePriority = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const result = await decisionService.calculateAndSaveIncidentPriority(
    req.params['id']!,
  );

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Priority calculated and saved successfully.',
    data: result,
  });
};

/**
 * POST /api/incidents/:id/recommend-resource
 * ADMIN / COORDINATOR only — read-only recommendation, no assignment created
 */
export const recommendResource = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const result = await decisionService.recommendResourceForIncident(
    req.params['id']!,
  );

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: result.message,
    data: result,
  });
};

/**
 * PATCH /api/incidents/:id/cancel
 * CITIZEN — cancel their own PENDING incident.
 * ADMIN / COORDINATOR — cancel any cancellable incident.
 */
export const cancelIncident = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId = req.user!.userId;
  const userRole = req.user!.role;

  const incident = await incidentService.cancelIncident(
    req.params['id']!,
    userId,
    userRole,
  );

  await writeAuditLog({
    actorId: userId,
    action: 'CANCEL',
    entity: 'INCIDENT',
    entityId: incident.id,
    details: { cancelledBy: userRole },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Incident cancelled successfully.',
    data: incident,
  });
};

/**
 * GET /api/incidents/:id/assignments
 * Returns all assignments for a given incident.
 * Access is controlled by requireIncidentAccess middleware upstream.
 * CITIZEN sees assignments for their own incident (status updates on their report).
 */
export const getIncidentAssignments = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const assignments = await incidentService.getIncidentAssignments(req.params['id']!);

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Incident assignments retrieved successfully.',
    data: assignments,
  });
};