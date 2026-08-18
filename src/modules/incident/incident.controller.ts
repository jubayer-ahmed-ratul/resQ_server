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

/**
 * POST /api/v1/incidents
 */
export const createIncident = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const input = req.body as CreateIncidentInput;
  const userId = req.user!.userId;

  const incident = await incidentService.createIncident(input, userId);

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
  const result = await incidentService.getIncidents(filters, sort, pagination);

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Incidents retrieved successfully.',
    data: result,
  });
};

/**
 * GET /api/v1/incidents/:id
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
 * PATCH /api/v1/incidents/:id
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

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Incident updated successfully.',
    data: incident,
  });
};

/**
 * PATCH /api/v1/incidents/:id/validate
 */
export const validateIncident = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const incident = await incidentService.validateIncident(req.params['id']!);

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
