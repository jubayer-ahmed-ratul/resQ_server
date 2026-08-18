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

export const createResource = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const resource = await resourceService.createResource(
    req.body as CreateResourceInput,
  );
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
  const result = await resourceService.getResources(filters, pagination);
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
  );
  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Resource updated successfully.',
    data: resource,
  });
};
