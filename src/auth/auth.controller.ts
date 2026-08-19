import { Request, Response } from 'express';
import httpStatus from 'http-status';
import * as authService from './auth.service';
import sendResponse from '../utils/sendResponse';
import { RegisterInput, LoginInput, UpdateProfileInput } from './auth.interface';
import { writeAuditLog } from '../modules/audit/audit.service';

/**
 * POST /api/auth/register
 */
export const register = async (req: Request, res: Response): Promise<void> => {
  const input = req.body as RegisterInput;
  const user = await authService.register(input);

  sendResponse({
    res,
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Account created successfully.',
    data: user,
  });
};

/**
 * POST /api/auth/login
 */
export const login = async (req: Request, res: Response): Promise<void> => {
  const input = req.body as LoginInput;
  const result = await authService.login(input);

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Login successful.',
    data: result,
  });
};

/**
 * GET /api/auth/me
 * Requires: authenticate middleware (sets req.user)
 */
export const getMe = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const user = await authService.getMe(userId);

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'User profile retrieved successfully.',
    data: user,
  });
};

/**
 * PATCH /api/auth/me
 * Any authenticated user — update their own name/email/password.
 * Role cannot be changed here (ADMIN-only via /api/users).
 */
export const updateMe = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const input = req.body as UpdateProfileInput;

  const user = await authService.updateMe(userId, input);

  await writeAuditLog({
    actorId: userId,
    action: 'UPDATE',
    entity: 'USER',
    entityId: userId,
    details: { updatedFields: Object.keys(req.body), self: true },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Profile updated successfully.',
    data: user,
  });
};
