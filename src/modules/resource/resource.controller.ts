import { Request, Response } from 'express';
import httpStatus from 'http-status';
import * as resourceService from './resource.service';
import sendResponse from '../../utils/sendResponse';
import {
  CreateResourceInput,
  UpdateResourceInput,
  ResourceFilters,
  ResourceType,
  ResourceStatus,
} from './resource.interface';
import { parsePagination } from '../../utils/pagination';
import { writeAuditLog } from '../audit/audit.service';

export const createResource = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const resource = await resourceService.createResource(
    req.body as CreateResourceInput,
  );

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'CREATE',
    entity: 'RESOURCE',
    entityId: resource.id,
    details: { name: resource.name, type: resource.type },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Resource created successfully.',
    data: resource,
  });
};

export const getResources = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const filters: ResourceFilters = {
    ...(req.query['type'] && { type: req.query['type'] as ResourceType }),
    ...(req.query['status'] && {
      status: req.query['status'] as ResourceStatus,
    }),
  };
  const pagination = parsePagination(req);
  const result = await resourceService.getResources(filters, pagination, req.user!);
  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Resources retrieved successfully.',
    data: result,
  });
};

export const getResourceById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const resource = await resourceService.getResourceById(req.params['id']!);
  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Resource retrieved successfully.',
    data: resource,
  });
};

export const updateResource = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const resource = await resourceService.updateResource(
    req.params['id']!,
    req.body as UpdateResourceInput,
    req.user!,
  );

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'UPDATE',
    entity: 'RESOURCE',
    entityId: resource.id,
    details: { updatedFields: Object.keys(req.body) },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Resource updated successfully.',
    data: resource,
  });
};

export const assignOperator = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { operatorId } = req.body as { operatorId: string };
  const resource = await resourceService.assignOperator(
    req.params['id']!,
    operatorId,
  );

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'ASSIGN',
    entity: 'RESOURCE',
    entityId: resource.id,
    details: { operatorId },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Operator assigned to resource successfully.',
    data: resource,
  });
};

export const removeOperator = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const resource = await resourceService.removeOperator(req.params['id']!);

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'REMOVE',
    entity: 'RESOURCE',
    entityId: resource.id,
    details: { removedOperator: true },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Operator removed from resource successfully.',
    data: resource,
  });
};

export const deactivateResource = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const resource = await resourceService.deactivateResource(req.params['id']!);

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'DEACTIVATE',
    entity: 'RESOURCE',
    entityId: resource.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Resource deactivated successfully.',
    data: resource,
  });
};