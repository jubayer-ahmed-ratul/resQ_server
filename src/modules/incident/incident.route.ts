import { Router } from 'express';
import { z } from 'zod';
import * as incidentController from './incident.controller';
import * as decisionController from '../decision/decision.controller';
import * as reoptimizationController from '../reoptimization/reoptimization.controller';
import { authenticate, authorizeRoles } from '../../middlewares/auth';
import validate from '../../middlewares/validate';
import catchAsync from '../../utils/catchAsync';
import { idempotency } from '../../reliability/idempotency';

const router = Router();

// ─── Validation Schemas ────────────────────────────────────────────────────

const severityValues = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const timeSensitivityValues = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const statusValues = [
  'PENDING',
  'VALIDATED',
  'PROCESSING',
  'ASSIGNED',
  'DISPATCHED',
  'RESOLVED',
  'CANCELLED',
] as const;

const createIncidentSchema = z.object({
  title: z
    .string({ error: 'Title is required.' })
    .min(3, 'Title must be at least 3 characters.')
    .max(200, 'Title must not exceed 200 characters.')
    .trim(),

  description: z
    .string({ error: 'Description is required.' })
    .min(10, 'Description must be at least 10 characters.')
    .max(2000, 'Description must not exceed 2000 characters.')
    .trim(),

  severity: z.enum(severityValues, {
    error: `Severity must be one of: ${severityValues.join(', ')}.`,
  }),

  affectedPeople: z
    .number({ error: 'affectedPeople must be a number.' })
    .int('affectedPeople must be an integer.')
    .min(0, 'affectedPeople must be 0 or greater.'),

  latitude: z
    .number({ error: 'Latitude must be a number.' })
    .min(-90, 'Latitude must be between -90 and 90.')
    .max(90, 'Latitude must be between -90 and 90.'),

  longitude: z
    .number({ error: 'Longitude must be a number.' })
    .min(-180, 'Longitude must be between -180 and 180.')
    .max(180, 'Longitude must be between -180 and 180.'),

  timeSensitivity: z.enum(timeSensitivityValues, {
    error: `timeSensitivity must be one of: ${timeSensitivityValues.join(', ')}.`,
  }),

  environmentalCondition: z
    .string()
    .max(500, 'Environmental condition must not exceed 500 characters.')
    .trim()
    .optional(),

  resourceRequirements: z
    .array(z.string().min(1, 'Resource requirement must not be empty.'))
    .default([]),
});

const updateIncidentSchema = z.object({
  title: z
    .string()
    .min(3, 'Title must be at least 3 characters.')
    .max(200, 'Title must not exceed 200 characters.')
    .trim()
    .optional(),

  description: z
    .string()
    .min(10, 'Description must be at least 10 characters.')
    .max(2000, 'Description must not exceed 2000 characters.')
    .trim()
    .optional(),

  severity: z
    .enum(severityValues, {
      error: `Severity must be one of: ${severityValues.join(', ')}.`,
    })
    .optional(),

  affectedPeople: z
    .number()
    .int('affectedPeople must be an integer.')
    .min(0, 'affectedPeople must be 0 or greater.')
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

  timeSensitivity: z
    .enum(timeSensitivityValues, {
      error: `timeSensitivity must be one of: ${timeSensitivityValues.join(', ')}.`,
    })
    .optional(),

  environmentalCondition: z
    .string()
    .max(500, 'Environmental condition must not exceed 500 characters.')
    .trim()
    .optional(),

  resourceRequirements: z
    .array(z.string().min(1, 'Resource requirement must not be empty.'))
    .optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(statusValues, {
    error: `Status must be one of: ${statusValues.join(', ')}.`,
  }),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/incidents
 * Any authenticated user can submit an incident.
 * Idempotency-Key header supported: safe to retry without creating duplicates.
 */
router.post(
  '/',
  authenticate,
  idempotency(),
  validate(createIncidentSchema),
  catchAsync(incidentController.createIncident),
);

/**
 * GET /api/v1/incidents
 * Any authenticated user can list incidents.
 * Query params: ?status=PENDING&severity=HIGH
 */
router.get('/', authenticate, catchAsync(incidentController.getIncidents));

/**
 * GET /api/v1/incidents/:id
 * Any authenticated user can view an incident.
 */
router.get(
  '/:id',
  authenticate,
  catchAsync(incidentController.getIncidentById),
);

/**
 * PATCH /api/v1/incidents/:id
 * Citizens: own PENDING incidents only.
 * ADMIN / COORDINATOR: any incident.
 */
router.patch(
  '/:id',
  authenticate,
  validate(updateIncidentSchema),
  catchAsync(incidentController.updateIncident),
);

/**
 * PATCH /api/v1/incidents/:id/validate
 * ADMIN / COORDINATOR only — moves PENDING → VALIDATED.
 */
router.patch(
  '/:id/validate',
  authenticate,
  authorizeRoles('ADMIN', 'COORDINATOR'),
  catchAsync(incidentController.validateIncident),
);

/**
 * PATCH /api/incidents/:id/status
 * ADMIN / COORDINATOR only — operational status transitions.
 */
router.patch(
  '/:id/status',
  authenticate,
  authorizeRoles('ADMIN', 'COORDINATOR'),
  validate(updateStatusSchema),
  catchAsync(incidentController.updateIncidentStatus),
);

/**
 * POST /api/incidents/:id/calculate-priority
 * ADMIN / COORDINATOR only — manually trigger priority recalculation.
 */
router.post(
  '/:id/calculate-priority',
  authenticate,
  authorizeRoles('ADMIN', 'COORDINATOR'),
  catchAsync(incidentController.calculatePriority),
);

/**
 * POST /api/incidents/:id/recommend-resource
 * ADMIN / COORDINATOR only — greedy resource recommendation (read-only).
 */
router.post(
  '/:id/recommend-resource',
  authenticate,
  authorizeRoles('ADMIN', 'COORDINATOR'),
  catchAsync(incidentController.recommendResource),
);

/**
 * GET /api/incidents/:id/decisions
 * ADMIN / COORDINATOR only — full decision history for this incident.
 * Decision logs are immutable — no PATCH or DELETE exposed.
 */
router.get(
  '/:id/decisions',
  authenticate,
  authorizeRoles('ADMIN', 'COORDINATOR'),
  catchAsync(decisionController.getDecisionsByIncident),
);

/**
 * GET /api/incidents/:id/reoptimizations
 * ADMIN / COORDINATOR only — re-optimization history for this incident.
 */
router.get(
  '/:id/reoptimizations',
  authenticate,
  authorizeRoles('ADMIN', 'COORDINATOR'),
  catchAsync(reoptimizationController.getReoptimizationLogsByIncident),
);

export default router;
