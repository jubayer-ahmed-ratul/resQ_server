import { Router } from 'express';
import { z } from 'zod';
import * as assignmentController from './assignment.controller';
import { authenticate } from '../../middlewares/auth';
import { requireRoles, requireAssignmentAccess } from '../../middlewares/permissions';
import validate from '../../middlewares/validate';
import catchAsync from '../../utils/catchAsync';
import { assignmentReoptimizeRouter } from '../reoptimization/reoptimization.route';
import { idempotency } from '../../reliability/idempotency';

const router = Router();

// ─── Validation schemas ───────────────────────────────────────────────────────

const createAssignmentSchema = z.object({
  incidentId: z
    .string({ error: 'incidentId is required.' })
    .min(1, 'incidentId must not be empty.'),
  resourceId: z
    .string({ error: 'resourceId is required.' })
    .min(1, 'resourceId must not be empty.'),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/assignments
 * ADMIN, COORDINATOR only — creates assignment + marks resource BUSY + marks incident ASSIGNED
 * Idempotency-Key header supported: safe to retry without double-assigning.
 */
router.post(
  '/',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR'),
  idempotency(),
  validate(createAssignmentSchema),
  catchAsync(assignmentController.createAssignment),
);

/**
 * GET /api/assignments
 * ADMIN, COORDINATOR — view all assignments.
 * OPERATOR — only assignments for their resources (handled in controller).
 * CITIZEN — only assignments for their own incidents (handled in controller).
 */
router.get(
  '/',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR', 'OPERATOR', 'CITIZEN'),
  catchAsync(assignmentController.getAssignments),
);

/**
 * GET /api/assignments/:id
 * ADMIN, COORDINATOR — view any assignment.
 * OPERATOR — only assignments for their resources.
 * CITIZEN — only assignments for their own incidents.
 */
router.get(
  '/:id',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR', 'OPERATOR', 'CITIZEN'),
  requireAssignmentAccess,
  catchAsync(assignmentController.getAssignmentById),
);

/**
 * PATCH /api/assignments/:id/complete
 * ADMIN, COORDINATOR — complete any assignment.
 * OPERATOR — only assignments for their resources.
 * ACTIVE → COMPLETED, Resource → AVAILABLE, Incident → IN_PROGRESS
 */
router.patch(
  '/:id/complete',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR', 'OPERATOR'),
  requireAssignmentAccess,
  catchAsync(assignmentController.completeAssignment),
);

/**
 * PATCH /api/assignments/:id/cancel
 * ADMIN, COORDINATOR only
 * ACTIVE → CANCELLED, Resource → AVAILABLE, Incident → APPROVED
 */
router.patch(
  '/:id/cancel',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR'),
  catchAsync(assignmentController.cancelAssignment),
);

/**
 * POST /api/assignments/:id/reoptimize
 * ADMIN, COORDINATOR only — manually trigger dynamic re-optimization
 */
router.use('/:id/reoptimize', assignmentReoptimizeRouter);

export default router;