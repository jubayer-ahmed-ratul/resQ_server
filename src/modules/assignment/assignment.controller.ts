import { Request, Response } from 'express';
import httpStatus from 'http-status';
import * as assignmentService from './assignment.service';
import sendResponse from '../../utils/sendResponse';
import { CreateAssignmentInput, AssignmentFilters, AssignmentStatus } from './assignment.interface';
import { parsePagination } from '../../utils/pagination';

export const createAssignment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const assignment = await assignmentService.createAssignment(
    req.body as CreateAssignmentInput,
  );
  sendResponse({
    res,
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Resource assigned successfully.',
    data: assignment,
  });
};

export const getAssignments = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const filters: AssignmentFilters = {
    ...(req.query['incidentId'] && { incidentId: req.query['incidentId'] as string }),
    ...(req.query['resourceId'] && { resourceId: req.query['resourceId'] as string }),
    ...(req.query['status'] && { status: req.query['status'] as AssignmentStatus }),
  };
  const pagination = parsePagination(req);
  const result = await assignmentService.getAssignments(filters, pagination);
  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Assignments retrieved successfully.',
    data: result,
  });
};

export const getAssignmentById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const assignment = await assignmentService.getAssignmentById(req.params['id']!);
  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Assignment retrieved successfully.',
    data: assignment,
  });
};

export const completeAssignment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const assignment = await assignmentService.completeAssignment(req.params['id']!);
  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Assignment completed successfully.',
    data: assignment,
  });
};

export const cancelAssignment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const assignment = await assignmentService.cancelAssignment(req.params['id']!);
  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Assignment cancelled successfully.',
    data: assignment,
  });
};
