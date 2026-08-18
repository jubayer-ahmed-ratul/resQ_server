import { Router } from 'express';
import catchAsync from '../utils/catchAsync';
import { liveness, readiness } from './health.controller';

const router = Router();

/** GET /health — liveness */
router.get('/health', liveness);

/** GET /ready — readiness with dependency checks */
router.get('/ready', catchAsync(readiness));

export default router;
