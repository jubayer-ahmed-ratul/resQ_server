import { Request, Response } from 'express';
import httpStatus from 'http-status';
import * as hospitalService from './hospital.service';
import sendResponse from '../../utils/sendResponse';
import {
  CreateHospitalInput,
  UpdateHospitalInput,
  HospitalFilters,
  HospitalStatus,
} from './hospital.interface';
import { parsePagination } from '../../utils/pagination';
import { writeAuditLog } from '../audit/audit.service';

export const createHospital = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const hospital = await hospitalService.createHospital(
    req.body as CreateHospitalInput,
  );

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'CREATE',
    entity: 'HOSPITAL',
    entityId: hospital.id,
    details: { name: hospital.name },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.CREATED,
    success: true,
    message: 'Hospital created successfully.',
    data: hospital,
  });
};

export const getHospitals = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const filters: HospitalFilters = {
    ...(req.query['status'] && {
      status: req.query['status'] as HospitalStatus,
    }),
  };
  const pagination = parsePagination(req);
  const result = await hospitalService.getHospitals(filters, pagination, req.user!);
  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hospitals retrieved successfully.',
    data: result,
  });
};

export const getHospitalById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const hospital = await hospitalService.getHospitalById(req.params['id']!);
  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hospital retrieved successfully.',
    data: hospital,
  });
};

export const getHospitalAvailability = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const availability = await hospitalService.getHospitalAvailability(req.params['id']!);
  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hospital availability retrieved successfully.',
    data: availability,
  });
};

export const updateHospital = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const hospital = await hospitalService.updateHospital(
    req.params['id']!,
    req.body as UpdateHospitalInput,
    req.user!,
  );

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'UPDATE',
    entity: 'HOSPITAL',
    entityId: hospital.id,
    details: { updatedFields: Object.keys(req.body) },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hospital updated successfully.',
    data: hospital,
  });
};

export const assignOperator = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { operatorId } = req.body as { operatorId: string };
  const hospital = await hospitalService.assignOperator(
    req.params['id']!,
    operatorId,
  );

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'ASSIGN',
    entity: 'HOSPITAL',
    entityId: hospital.id,
    details: { operatorId },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Operator assigned to hospital successfully.',
    data: hospital,
  });
};

export const removeOperator = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const hospital = await hospitalService.removeOperator(req.params['id']!);

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'REMOVE',
    entity: 'HOSPITAL',
    entityId: hospital.id,
    details: { removedOperator: true },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Operator removed from hospital successfully.',
    data: hospital,
  });
};

export const deactivateHospital = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const hospital = await hospitalService.deactivateHospital(req.params['id']!);

  await writeAuditLog({
    actorId: req.user!.userId,
    action: 'DEACTIVATE',
    entity: 'HOSPITAL',
    entityId: hospital.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hospital deactivated successfully.',
    data: hospital,
  });
};