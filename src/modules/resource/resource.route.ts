import { Router } from 'express';
import { z } from 'zod';
import * as resourceController from './resource.controller';
import { authenticate, authorizeRoles } from '../../middlewares/auth';
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
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/resources
 * ADMIN, COORDINATOR only
 */
router.post(
  '/',
  authenticate,
  authorizeRoles('ADMIN', 'COORDINATOR'),
  validate(createResourceSchema),
  catchAsync(resourceController.createResource),
);

/**
 * GET /api/resources
 * All authenticated users — supports ?type= and ?status=
 */
router.get('/', authenticate, catchAsync(resourceController.getResources));

/**
 * GET /api/resources/:id
 * All authenticated users
 */
router.get(
  '/:id',
  authenticate,
  catchAsync(resourceController.getResourceById),
);

/**
 * PATCH /api/resources/:id
 * ADMIN, COORDINATOR — full update
 * OPERATOR — can also update (status/location)
 */
router.patch(
  '/:id',
  authenticate,
  authorizeRoles('ADMIN', 'COORDINATOR', 'OPERATOR'),
  validate(updateResourceSchema),
  catchAsync(resourceController.updateResource),
);

export default router;
