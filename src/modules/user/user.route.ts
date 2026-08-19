import { Router } from 'express';
import { z } from 'zod';
import * as userController from './user.controller';
import { authenticate } from '../../middlewares/auth';
import { requireRoles } from '../../middlewares/permissions';
import validate from '../../middlewares/validate';
import catchAsync from '../../utils/catchAsync';

const router = Router();

// ─── Validation Schemas ───────────────────────────────────────────────────────

const roleValues = ['ADMIN', 'COORDINATOR', 'OPERATOR', 'CITIZEN'] as const;
const statusValues = ['ACTIVE', 'INACTIVE'] as const;

const createUserSchema = z.object({
  name: z
    .string({ error: 'Name is required.' })
    .min(2, 'Name must be at least 2 characters.')
    .max(100, 'Name must not exceed 100 characters.')
    .trim(),
  email: z
    .string({ error: 'Email is required.' })
    .email('Please provide a valid email address.')
    .toLowerCase()
    .trim(),
  password: z
    .string({ error: 'Password is required.' })
    .min(8, 'Password must be at least 8 characters.')
    .max(64, 'Password must not exceed 64 characters.')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain at least one uppercase letter, one lowercase letter, and one number.',
    ),
  role: z.enum(roleValues, {
    error: `Role must be one of: ${roleValues.join(', ')}.`,
  }),
});

const updateUserSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters.')
    .max(100, 'Name must not exceed 100 characters.')
    .trim()
    .optional(),
  email: z
    .string()
    .email('Please provide a valid email address.')
    .toLowerCase()
    .trim()
    .optional(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(64, 'Password must not exceed 64 characters.')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain at least one uppercase letter, one lowercase letter, and one number.',
    )
    .optional(),
  role: z
    .enum(roleValues, {
      error: `Role must be one of: ${roleValues.join(', ')}.`,
    })
    .optional(),
  status: z
    .enum(statusValues, {
      error: `Status must be one of: ${statusValues.join(', ')}.`,
    })
    .optional(),
});

// ─── Routes (ADMIN only) ──────────────────────────────────────────────────────

/**
 * POST /api/users
 * ADMIN only — create a user (any role).
 */
router.post(
  '/',
  authenticate,
  requireRoles('ADMIN'),
  validate(createUserSchema),
  catchAsync(userController.createUser),
);

/**
 * GET /api/users
 * ADMIN only — list users with optional ?role= and ?status= filters.
 */
router.get(
  '/',
  authenticate,
  requireRoles('ADMIN'),
  catchAsync(userController.getUsers),
);

/**
 * GET /api/users/:id
 * ADMIN only — view a single user.
 */
router.get(
  '/:id',
  authenticate,
  requireRoles('ADMIN'),
  catchAsync(userController.getUserById),
);

/**
 * PATCH /api/users/:id
 * ADMIN only — edit a user (name, email, password, role, status).
 */
router.patch(
  '/:id',
  authenticate,
  requireRoles('ADMIN'),
  validate(updateUserSchema),
  catchAsync(userController.updateUser),
);

/**
 * PATCH /api/users/:id/deactivate
 * ADMIN only — deactivate a user.
 */
router.patch(
  '/:id/deactivate',
  authenticate,
  requireRoles('ADMIN'),
  catchAsync(userController.deactivateUser),
);

/**
 * PATCH /api/users/:id/activate
 * ADMIN only — reactivate a user.
 */
router.patch(
  '/:id/activate',
  authenticate,
  requireRoles('ADMIN'),
  catchAsync(userController.activateUser),
);

export default router;