/**
 * Health Controller — Part 11
 */

import { Request, Response } from 'express';
import httpStatus from 'http-status';
import { getLivenessStatus, getReadinessStatus } from './health.service';

/**
 * GET /health
 * Liveness — always 200 if the process is running.
 */
export const liveness = (_req: Request, res: Response): void => {
  res.status(httpStatus.OK).json(getLivenessStatus());
};

/**
 * GET /ready
 * Readiness — 200 if all critical deps are healthy, 503 if not.
 */
export const readiness = async (_req: Request, res: Response): Promise<void> => {
  const result = await getReadinessStatus();
  const statusCode =
    result.status === 'not_ready'
      ? httpStatus.SERVICE_UNAVAILABLE
      : httpStatus.OK;
  res.status(statusCode).json(result);
};
