import { Request, Response } from 'express';
import httpStatus from 'http-status';
import * as decisionService from './decision.service';
import sendResponse from '../../utils/sendResponse';

/**
 * GET /api/incidents/:id/decisions
 * ADMIN, COORDINATOR only — full decision history for an incident
 */
export const getDecisionsByIncident = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const logs = await decisionService.getDecisionsByIncident(req.params['id']!);
  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Decision logs retrieved successfully.',
    data: logs,
  });
};

/**
 * GET /api/decisions/:id
 * ADMIN, COORDINATOR only — single decision log detail
 */
export const getDecisionById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const log = await decisionService.getDecisionById(req.params['id']!);
  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Decision log retrieved successfully.',
    data: log,
  });
};
