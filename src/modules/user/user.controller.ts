import { Request, Response } from 'express';
import httpStatus from 'http-status';
import * as userService from './user.service';
import sendResponse from '../../utils/sendResponse';
import { CreateUserInput, UpdateUserInput, UserFilters, UserRole, UserStatus } from './user.interface';
import { parsePagination } from '../../utils/pagination';
import { writeAuditLog } from '../audit/audit.service';

export const createUser = async (req: Request, res: Response): Promise<void> => {
  const user = await userService.createUser(req.body as CreateUserInput);

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'CREATE',
    entity: 'USER',
    entityId: user.id,
    details: { role: user.role },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'User created successfully.',
    data: user,
  });
};

export const getUsers = async (req: Request, res: Response): Promise<void> => {
  const filters: UserFilters = {
    ...(req.query['role'] && { role: req.query['role'] as UserRole }),
    ...(req.query['status'] && { status: req.query['status'] as UserStatus }),
  };
  const pagination = parsePagination(req);
  const result = await userService.getUsers(filters, pagination);

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Users retrieved successfully.',
    data: result,
  });
};

export const getUserById = async (req: Request, res: Response): Promise<void> => {
  const user = await userService.getUserById(req.params['id']!);

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'User retrieved successfully.',
    data: user,
  });
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
  const user = await userService.updateUser(
    req.params['id']!,
    req.body as UpdateUserInput,
  );

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'UPDATE',
    entity: 'USER',
    entityId: user.id,
    details: { updatedFields: Object.keys(req.body) },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'User updated successfully.',
    data: user,
  });
};

export const deactivateUser = async (req: Request, res: Response): Promise<void> => {
  const user = await userService.deactivateUser(req.params['id']!);

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'DEACTIVATE',
    entity: 'USER',
    entityId: user.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'User deactivated successfully.',
    data: user,
  });
};

export const activateUser = async (req: Request, res: Response): Promise<void> => {
  const user = await userService.activateUser(req.params['id']!);

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'ACTIVATE',
    entity: 'USER',
    entityId: user.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'User activated successfully.',
    data: user,
  });
};