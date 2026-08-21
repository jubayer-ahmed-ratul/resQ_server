import { Router } from 'express';
import { z } from 'zod';
import * as incidentController from './incident.controller';
import * as decisionController from '../decision/decision.controller';
import * as reoptimizationController from '../reoptimization/reoptimization.controller';
import { authenticate } from '../../middlewares/auth';
import { requireRoles, requireIncidentAccess } from '../../middlewares/permissions';
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
 * POST /api/incidents
 * CITIZEN, OPERATOR, ADMIN, COORDINATOR — create an emergency report.
 * OPERATOR/ADMIN-created incidents → auto VALIDATED
 * CITIZEN-created incidents → PENDING (requires COORDINATOR approval)
 */
router.post(
  '/',
  authenticate,
  requireRoles('CITIZEN', 'ADMIN', 'COORDINATOR', 'OPERATOR'),
  idempotency(),
  validate(createIncidentSchema),
  catchAsync(incidentController.createIncident),
);

/**
 * GET /api/incidents
 * ADMIN, COORDINATOR — view all incidents.
 * CITIZEN — only their own incidents (handled in controller).
 * OPERATOR — only incidents assigned to their resource (handled in controller).
 */
router.get(
  '/',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR', 'CITIZEN', 'OPERATOR'),
  catchAsync(incidentController.getIncidents),
);

/**
 * GET /api/incidents/:id
 * ADMIN, COORDINATOR — view any incident.
 * CITIZEN — only their own.
 * OPERATOR — only assigned to their resource.
 */
router.get(
  '/:id',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR', 'CITIZEN', 'OPERATOR'),
  requireIncidentAccess,
  catchAsync(incidentController.getIncidentById),
);

/**
 * PATCH /api/incidents/:id
 * CITIZEN: own PENDING incidents only.
 * ADMIN / COORDINATOR: any incident.
 * OPERATOR: denied.
 */
router.patch(
  '/:id',
  authenticate,
  requireRoles('CITIZEN', 'ADMIN', 'COORDINATOR'),
  requireIncidentAccess,
  validate(updateIncidentSchema),
  catchAsync(incidentController.updateIncident),
);

/**
 * PATCH /api/incidents/:id/validate
 * COORDINATOR / ADMIN only — moves PENDING → VALIDATED.
 * Only needed for CITIZEN-created incidents.
 * OPERATOR-created incidents are auto-validated on creation.
 */
router.patch(
  '/:id/validate',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR'),
  catchAsync(incidentController.validateIncident),
);

/**
 * PATCH /api/incidents/:id/cancel
 * CITIZEN — cancel their own PENDING incident.
 * ADMIN / COORDINATOR — cancel any non-resolved incident.
 */
router.patch(
  '/:id/cancel',
  authenticate,
  requireRoles('CITIZEN', 'ADMIN', 'COORDINATOR'),
  requireIncidentAccess,
  catchAsync(incidentController.cancelIncident),
);

/**
 * PATCH /api/incidents/:id/status
 * ADMIN / COORDINATOR only — operational status transitions.
 */
router.patch(
  '/:id/status',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR'),
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
  requireRoles('ADMIN', 'COORDINATOR'),
  catchAsync(incidentController.calculatePriority),
);

/**
 * POST /api/incidents/:id/recommend-resource
 * ADMIN / COORDINATOR only — greedy resource recommendation (read-only).
 */
router.post(
  '/:id/recommend-resource',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR'),
  catchAsync(incidentController.recommendResource),
);

/**
 * GET /api/incidents/:id/decisions
 * ADMIN / COORDINATOR only — full decision history for this incident.
 */
router.get(
  '/:id/decisions',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR'),
  catchAsync(decisionController.getDecisionsByIncident),
);

/**
 * GET /api/incidents/:id/assignments
 * ADMIN, COORDINATOR — view all assignments for this incident.
 * CITIZEN — only for their own incident (updates on their report).
 * OPERATOR — only if their resource is assigned to this incident.
 */
router.get(
  '/:id/assignments',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR', 'CITIZEN', 'OPERATOR'),
  requireIncidentAccess,
  catchAsync(incidentController.getIncidentAssignments),
);

/**
 * GET /api/incidents/:id/reoptimizations
 * ADMIN / COORDINATOR only — re-optimization history for this incident.
 */
router.get(
  '/:id/reoptimizations',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR'),
  catchAsync(reoptimizationController.getReoptimizationLogsByIncident),
);

export default router;