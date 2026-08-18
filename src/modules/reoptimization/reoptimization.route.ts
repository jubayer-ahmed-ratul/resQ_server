import { Router } from 'express';
import { z } from 'zod';
import * as reoptimizationController from './reoptimization.controller';
import { authenticate, authorizeRoles } from '../../middlewares/auth';
import validate from '../../middlewares/validate';
import catchAsync from '../../utils/catchAsync';
import { idempotency } from '../../reliability/idempotency';

const router = Router();

// ─── Validation Schemas ───────────────────────────────────────────────────────

const triggerValues = [
  'RESOURCE_FAILURE',
  'RESOURCE_UNAVAILABLE',
  'RESOURCE_MAINTENANCE',
  'ACCESS_CONDITION_CHANGE',
  'HIGHER_PRIORITY_INCIDENT',
  'CAPACITY_CHANGE',
] as const;

const accessConditionValues = ['NORMAL', 'DIFFICULT', 'BLOCKED'] as const;

const reoptimizeSchema = z.object({
  trigger: z.enum(triggerValues, {
    error: `trigger must be one of: ${triggerValues.join(', ')}.`,
  }),
  accessCondition: z
    .enum(accessConditionValues, {
      error: `accessCondition must be one of: ${accessConditionValues.join(', ')}.`,
    })
    .optional(),
  competingIncidentPriority: z
    .number()
    .min(0, 'competingIncidentPriority must be between 0 and 100.')
    .max(100, 'competingIncidentPriority must be between 0 and 100.')
    .optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/reoptimizations/:id
 * ADMIN, COORDINATOR only — retrieve a single re-optimization log
 */
router.get(
  '/:id',
  authenticate,
  authorizeRoles('ADMIN', 'COORDINATOR'),
  catchAsync(reoptimizationController.getReoptimizationLogById),
);

export default router;

// ─── Sub-router for assignment re-optimization ────────────────────────────────
// Mounted at /api/assignments via assignment.route.ts

export const assignmentReoptimizeRouter = Router({ mergeParams: true });

/**
 * POST /api/assignments/:id/reoptimize
 * ADMIN, COORDINATOR only — manually trigger re-optimization
 * Idempotency-Key supported: safe to retry without double-reoptimizing.
 */
assignmentReoptimizeRouter.post(
  '/',
  authenticate,
  authorizeRoles('ADMIN', 'COORDINATOR'),
  idempotency(),
  validate(reoptimizeSchema),
  catchAsync(reoptimizationController.reoptimizeAssignment),
);

// ─── Sub-router for incident re-optimization history ─────────────────────────
// Mounted at /api/incidents via incident.route.ts

export const incidentReoptimizationRouter = Router({ mergeParams: true });

/**
 * GET /api/incidents/:id/reoptimizations
 * ADMIN, COORDINATOR only — full re-optimization history for an incident
 */
incidentReoptimizationRouter.get(
  '/',
  authenticate,
  authorizeRoles('ADMIN', 'COORDINATOR'),
  catchAsync(reoptimizationController.getReoptimizationLogsByIncident),
);
