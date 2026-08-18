import { Request, Response } from 'express';
import httpStatus from 'http-status';
import * as reoptimizationService from './reoptimization.service';
import sendResponse from '../../utils/sendResponse';
import { ReoptimizeInput } from './reoptimization.interface';

/**
 * POST /api/assignments/:id/reoptimize
 * ADMIN, COORDINATOR only
 *
 * Manually triggers re-optimization for an active assignment.
 * Body: { trigger, accessCondition?, competingIncidentPriority? }
 */
export const reoptimizeAssignment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const input: ReoptimizeInput = {
    assignmentId: req.params['id']!,
    trigger: req.body['trigger'],
    accessCondition: req.body['accessCondition'],
    competingIncidentPriority: req.body['competingIncidentPriority'],
  };

  const result = await reoptimizationService.reoptimizeAssignment(input);

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: result.reoptimized
      ? 'Assignment re-optimized successfully.'
      : 'Re-optimization evaluated — no replacement made.',
    data: result,
  });
};

/**
 * GET /api/incidents/:id/reoptimizations
 * ADMIN, COORDINATOR only
 *
 * Returns all re-optimization logs for an incident, newest first.
 */
export const getReoptimizationLogsByIncident = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const logs = await reoptimizationService.getReoptimizationLogsByIncident(
    req.params['id']!,
  );
  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Re-optimization logs retrieved successfully.',
    data: logs,
  });
};

/**
 * GET /api/reoptimizations/:id
 * ADMIN, COORDINATOR only
 *
 * Returns a single re-optimization log.
 */
export const getReoptimizationLogById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const log = await reoptimizationService.getReoptimizationLogById(
    req.params['id']!,
  );
  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Re-optimization log retrieved successfully.',
    data: log,
  });
};
