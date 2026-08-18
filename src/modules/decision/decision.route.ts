import { Router } from 'express';
import * as decisionController from './decision.controller';
import { authenticate, authorizeRoles } from '../../middlewares/auth';
import catchAsync from '../../utils/catchAsync';

const router = Router();

/**
 * GET /api/decisions/:id
 * ADMIN, COORDINATOR only — retrieve a single decision log
 */
router.get(
  '/:id',
  authenticate,
  authorizeRoles('ADMIN', 'COORDINATOR'),
  catchAsync(decisionController.getDecisionById),
);

export default router;
