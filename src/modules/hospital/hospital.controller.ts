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

export const createHospital = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const hospital = await hospitalService.createHospital(
    req.body as CreateHospitalInput,
  );
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
  const result = await hospitalService.getHospitals(filters, pagination);
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
  );
  sendResponse({
    res,
    statusCode: httpStatus.OK,
    success: true,
    message: 'Hospital updated successfully.',
    data: hospital,
  });
};
