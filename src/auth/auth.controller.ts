import { Request, Response } from 'express';
import httpStatus from 'http-status';
import * as authService from './auth.service';
import sendResponse from '../utils/sendResponse';
import { RegisterInput, LoginInput } from './auth.interface';

/**
 * POST /api/v1/auth/register
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
 * POST /api/v1/auth/login
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
 * GET /api/v1/auth/me
 * Requires: authenticate middleware (sets req.user)
 */
export const getMe = async (req: Request, res: Response): Promise<void> => {
  // req.user is guaranteed by the authenticate middleware
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
