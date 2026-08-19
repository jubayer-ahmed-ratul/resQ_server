import { Router } from 'express';
import { z } from 'zod';
import * as hospitalController from './hospital.controller';
import { authenticate } from '../../middlewares/auth';
import { requireRoles, requireHospitalAccess } from '../../middlewares/permissions';
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

    assignedOperatorId: z.string().optional(),
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

  assignedOperatorId: z.string().nullable().optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/hospitals
 * ADMIN only — create a hospital.
 */
router.post(
  '/',
  authenticate,
  requireRoles('ADMIN'),
  validate(createHospitalSchema),
  catchAsync(hospitalController.createHospital),
);

/**
 * GET /api/hospitals
 * ADMIN, COORDINATOR — view all hospitals.
 * OPERATOR — only their assigned hospital (handled in controller).
 */
router.get(
  '/',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR', 'OPERATOR'),
  catchAsync(hospitalController.getHospitals),
);

/**
 * GET /api/hospitals/:id
 * ADMIN, COORDINATOR — view any hospital.
 * OPERATOR — only their assigned hospital.
 */
router.get(
  '/:id',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR', 'OPERATOR'),
  requireHospitalAccess,
  catchAsync(hospitalController.getHospitalById),
);

/**
 * GET /api/hospitals/:id/availability
 * ADMIN, COORDINATOR — view availability.
 * OPERATOR — only their assigned hospital.
 */
router.get(
  '/:id/availability',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR', 'OPERATOR'),
  requireHospitalAccess,
  catchAsync(hospitalController.getHospitalAvailability),
);

/**
 * PATCH /api/hospitals/:id
 * ADMIN — full update (name, location, capacity, status, operator).
 * OPERATOR — only capacity/status of their assigned hospital.
 */
router.patch(
  '/:id',
  authenticate,
  requireRoles('ADMIN', 'OPERATOR'),
  requireHospitalAccess,
  validate(updateHospitalSchema),
  catchAsync(hospitalController.updateHospital),
);

/**
 * PATCH /api/hospitals/:id/assign-operator
 * ADMIN only — assign an authorized Operator/staff to a hospital.
 */
router.patch(
  '/:id/assign-operator',
  authenticate,
  requireRoles('ADMIN'),
  validate(z.object({ operatorId: z.string().min(1) })),
  catchAsync(hospitalController.assignOperator),
);

/**
 * PATCH /api/hospitals/:id/remove-operator
 * ADMIN only — remove the Operator from a hospital.
 */
router.patch(
  '/:id/remove-operator',
  authenticate,
  requireRoles('ADMIN'),
  catchAsync(hospitalController.removeOperator),
);

/**
 * PATCH /api/hospitals/:id/deactivate
 * ADMIN only — soft-deactivate a hospital (sets status to CLOSED).
 */
router.patch(
  '/:id/deactivate',
  authenticate,
  requireRoles('ADMIN'),
  catchAsync(hospitalController.deactivateHospital),
);

export default router;