import { Router } from 'express';
import { z } from 'zod';
import * as resourceController from './resource.controller';
import { authenticate } from '../../middlewares/auth';
import { requireRoles, requireResourceAccess } from '../../middlewares/permissions';
import validate from '../../middlewares/validate';
import catchAsync from '../../utils/catchAsync';

const router = Router();

// ─── Validation Schemas ───────────────────────────────────────────────────────

const resourceTypeValues = [
  'AMBULANCE',
  'RESCUE_TEAM',
  'HELICOPTER',
  'OTHER',
] as const;

const resourceStatusValues = [
  'AVAILABLE',
  'BUSY',
  'UNAVAILABLE',
  'MAINTENANCE',
  'FAILED',
] as const;

const createResourceSchema = z.object({
  name: z
    .string({ error: 'Name is required.' })
    .min(2, 'Name must be at least 2 characters.')
    .max(100, 'Name must not exceed 100 characters.')
    .trim(),

  type: z.enum(resourceTypeValues, {
    error: `Type must be one of: ${resourceTypeValues.join(', ')}.`,
  }),

  latitude: z
    .number({ error: 'Latitude must be a number.' })
    .min(-90, 'Latitude must be between -90 and 90.')
    .max(90, 'Latitude must be between -90 and 90.'),

  longitude: z
    .number({ error: 'Longitude must be a number.' })
    .min(-180, 'Longitude must be between -180 and 180.')
    .max(180, 'Longitude must be between -180 and 180.'),

  capacity: z
    .number({ error: 'Capacity must be a number.' })
    .int('Capacity must be an integer.')
    .min(0, 'Capacity must be 0 or greater.'),

  status: z
    .enum(resourceStatusValues, {
      error: `Status must be one of: ${resourceStatusValues.join(', ')}.`,
    })
    .optional(),

  operatorId: z.string().optional(),
});

const updateResourceSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters.')
    .max(100, 'Name must not exceed 100 characters.')
    .trim()
    .optional(),

  type: z
    .enum(resourceTypeValues, {
      error: `Type must be one of: ${resourceTypeValues.join(', ')}.`,
    })
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

  capacity: z
    .number()
    .int('Capacity must be an integer.')
    .min(0, 'Capacity must be 0 or greater.')
    .optional(),

  status: z
    .enum(resourceStatusValues, {
      error: `Status must be one of: ${resourceStatusValues.join(', ')}.`,
    })
    .optional(),

  operatorId: z.string().nullable().optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/resources
 * ADMIN only — create a resource (with or without an assigned Operator).
 */
router.post(
  '/',
  authenticate,
  requireRoles('ADMIN'),
  validate(createResourceSchema),
  catchAsync(resourceController.createResource),
);

/**
 * GET /api/resources
 * ADMIN, COORDINATOR only — view all resources.
 * OPERATOR sees only their assigned resources (handled in controller).
 */
router.get(
  '/',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR', 'OPERATOR'),
  catchAsync(resourceController.getResources),
);

/**
 * GET /api/resources/:id
 * ADMIN, COORDINATOR — view any resource.
 * OPERATOR — only their assigned resource.
 */
router.get(
  '/:id',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR', 'OPERATOR'),
  requireResourceAccess,
  catchAsync(resourceController.getResourceById),
);

/**
 * PATCH /api/resources/:id
 * ADMIN — full update (name, type, location, capacity, status, operator).
 * OPERATOR — only status/location of their assigned resource.
 */
router.patch(
  '/:id',
  authenticate,
  requireRoles('ADMIN', 'OPERATOR'),
  requireResourceAccess,
  validate(updateResourceSchema),
  catchAsync(resourceController.updateResource),
);

/**
 * PATCH /api/resources/:id/assign-operator
 * ADMIN only — assign an Operator to a resource.
 */
router.patch(
  '/:id/assign-operator',
  authenticate,
  requireRoles('ADMIN'),
  validate(z.object({ operatorId: z.string().min(1) })),
  catchAsync(resourceController.assignOperator),
);

/**
 * PATCH /api/resources/:id/remove-operator
 * ADMIN only — remove the Operator from a resource.
 */
router.patch(
  '/:id/remove-operator',
  authenticate,
  requireRoles('ADMIN'),
  catchAsync(resourceController.removeOperator),
);

/**
 * PATCH /api/resources/:id/deactivate
 * ADMIN only — soft-deactivate a resource (sets status to UNAVAILABLE).
 */
router.patch(
  '/:id/deactivate',
  authenticate,
  requireRoles('ADMIN'),
  catchAsync(resourceController.deactivateResource),
);

export default router;