import { Router } from 'express';
import { z } from 'zod';
import * as assignmentController from './assignment.controller';
import { authenticate, authorizeRoles } from '../../middlewares/auth';
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
  authorizeRoles('ADMIN', 'COORDINATOR'),
  idempotency(),
  validate(createAssignmentSchema),
  catchAsync(assignmentController.createAssignment),
);

/**
 * GET /api/assignments
 * All authenticated — supports ?status= ?incidentId= ?resourceId=
 */
router.get(
  '/',
  authenticate,
  catchAsync(assignmentController.getAssignments),
);

/**
 * GET /api/assignments/:id
 * All authenticated
 */
router.get(
  '/:id',
  authenticate,
  catchAsync(assignmentController.getAssignmentById),
);

/**
 * PATCH /api/assignments/:id/complete
 * ADMIN, COORDINATOR, OPERATOR
 * ACTIVE → COMPLETED, Resource → AVAILABLE, Incident → DISPATCHED
 */
router.patch(
  '/:id/complete',
  authenticate,
  authorizeRoles('ADMIN', 'COORDINATOR', 'OPERATOR'),
  catchAsync(assignmentController.completeAssignment),
);

/**
 * PATCH /api/assignments/:id/cancel
 * ADMIN, COORDINATOR
 * ACTIVE → CANCELLED, Resource → AVAILABLE, Incident → PROCESSING
 */
router.patch(
  '/:id/cancel',
  authenticate,
  authorizeRoles('ADMIN', 'COORDINATOR'),
  catchAsync(assignmentController.cancelAssignment),
);

/**
 * POST /api/assignments/:id/reoptimize
 * ADMIN, COORDINATOR only — manually trigger dynamic re-optimization
 */
router.use('/:id/reoptimize', assignmentReoptimizeRouter);

export default router;
