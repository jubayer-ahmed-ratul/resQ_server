import { Router } from 'express';
import * as auditController from './audit.controller';
import { authenticate } from '../../middlewares/auth';
import { requireRoles } from '../../middlewares/permissions';
import catchAsync from '../../utils/catchAsync';

const router = Router();

/**
 * GET /api/audit-logs
 * ADMIN only — view all audit/activity logs.
 * COORDINATOR gets limited access (see note below).
 */
router.get(
  '/',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR'),
  catchAsync(auditController.getAuditLogs),
);

export default router;