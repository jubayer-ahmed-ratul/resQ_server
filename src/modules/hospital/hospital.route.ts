import { Router } from 'express';
import { z } from 'zod';
import * as hospitalController from './hospital.controller';
import { authenticate, authorizeRoles } from '../../middlewares/auth';
import validate from '../../middlewares/validate';
import catchAsync from '../../utils/catchAsync';

const router = Router();

// ─── Validation Schemas ───────────────────────────────────────────────────────

const hospitalStatusValues = ['OPERATIONAL', 'LIMITED', 'CLOSED'] as const;

const createHospitalSchema = z
  .object({
    name: z
      .string({ error: 'Name is required.' })
      .min(2, 'Name must be at least 2 characters.')
      .max(200, 'Name must not exceed 200 characters.')
      .trim(),

    latitude: z
      .number({ error: 'Latitude must be a number.' })
      .min(-90, 'Latitude must be between -90 and 90.')
      .max(90, 'Latitude must be between -90 and 90.'),

    longitude: z
      .number({ error: 'Longitude must be a number.' })
      .min(-180, 'Longitude must be between -180 and 180.')
      .max(180, 'Longitude must be between -180 and 180.'),

    bedCapacity: z
      .number({ error: 'bedCapacity must be a number.' })
      .int('bedCapacity must be an integer.')
      .min(0, 'bedCapacity must be 0 or greater.'),

    availableBeds: z
      .number({ error: 'availableBeds must be a number.' })
      .int('availableBeds must be an integer.')
      .min(0, 'availableBeds must be 0 or greater.'),

    icuCapacity: z
      .number({ error: 'icuCapacity must be a number.' })
      .int('icuCapacity must be an integer.')
      .min(0, 'icuCapacity must be 0 or greater.'),

    availableICUBeds: z
      .number({ error: 'availableICUBeds must be a number.' })
      .int('availableICUBeds must be an integer.')
      .min(0, 'availableICUBeds must be 0 or greater.'),

    status: z
      .enum(hospitalStatusValues, {
        error: `Status must be one of: ${hospitalStatusValues.join(', ')}.`,
      })
      .optional(),
  })
  .refine((d) => d.availableBeds <= d.bedCapacity, {
    message: 'availableBeds cannot exceed bedCapacity.',
    path: ['availableBeds'],
  })
  .refine((d) => d.availableICUBeds <= d.icuCapacity, {
    message: 'availableICUBeds cannot exceed icuCapacity.',
    path: ['availableICUBeds'],
  });

const updateHospitalSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters.')
    .max(200, 'Name must not exceed 200 characters.')
    .trim()
    .optional(),

  latitude: z
    .number()
    .min(-90, 'Latitude must be between -90 and 90.')
    .max(90, 'Latitude must be between -90 and 90.')
    .optional(),

  longitude: z
    .number()
    .min(-180, 'Longitude must be between -180 and 180.')
    .max(180, 'Longitude must be between -180 and 180.')
    .optional(),

  bedCapacity: z
    .number()
    .int('bedCapacity must be an integer.')
    .min(0, 'bedCapacity must be 0 or greater.')
    .optional(),

  availableBeds: z
    .number()
    .int('availableBeds must be an integer.')
    .min(0, 'availableBeds must be 0 or greater.')
    .optional(),

  icuCapacity: z
    .number()
    .int('icuCapacity must be an integer.')
    .min(0, 'icuCapacity must be 0 or greater.')
    .optional(),

  availableICUBeds: z
    .number()
    .int('availableICUBeds must be an integer.')
    .min(0, 'availableICUBeds must be 0 or greater.')
    .optional(),

  status: z
    .enum(hospitalStatusValues, {
      error: `Status must be one of: ${hospitalStatusValues.join(', ')}.`,
    })
    .optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/hospitals
 * ADMIN, COORDINATOR only
 */
router.post(
  '/',
  authenticate,
  authorizeRoles('ADMIN', 'COORDINATOR'),
  validate(createHospitalSchema),
  catchAsync(hospitalController.createHospital),
);

/**
 * GET /api/hospitals
 * All authenticated users — supports ?status=
 */
router.get('/', authenticate, catchAsync(hospitalController.getHospitals));

/**
 * GET /api/hospitals/:id
 * All authenticated users
 */
router.get(
  '/:id',
  authenticate,
  catchAsync(hospitalController.getHospitalById),
);

/**
 * GET /api/hospitals/:id/availability
 * All authenticated users — cached availability subset
 */
router.get(
  '/:id/availability',
  authenticate,
  catchAsync(hospitalController.getHospitalAvailability),
);

/**
 * PATCH /api/hospitals/:id
 * ADMIN, COORDINATOR only
 */
router.patch(
  '/:id',
  authenticate,
  authorizeRoles('ADMIN', 'COORDINATOR'),
  validate(updateHospitalSchema),
  catchAsync(hospitalController.updateHospital),
);

export default router;
