import { Router } from 'express';
import { z } from 'zod';
import * as authController from './auth.controller';
import { authenticate } from '../middlewares/auth';
import validate from '../middlewares/validate';
import catchAsync from '../utils/catchAsync';

const router = Router();

// ─── Validation Schemas ───────────────────────────────────────────────────────

const registerSchema = z.object({
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
  // No role field — only CITIZEN can self-register.
  // ADMIN/COORDINATOR/OPERATOR accounts are created by ADMIN via /api/users.
});

const loginSchema = z.object({
  email: z
    .string({ error: 'Email is required.' })
    .email('Please provide a valid email address.')
    .toLowerCase()
    .trim(),
  password: z
    .string({ error: 'Password is required.' })
    .min(1, 'Password is required.'),
});

const updateProfileSchema = z
  .object({
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
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field (name, email, or password) must be provided.',
  });

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/register
 * Public — creates a CITIZEN account only.
 */
router.post(
  '/register',
  validate(registerSchema),
  catchAsync(authController.register),
);

/**
 * POST /api/auth/login
 * Public — returns a JWT on valid credentials.
 */
router.post(
  '/login',
  validate(loginSchema),
  catchAsync(authController.login),
);

/**
 * GET /api/auth/me
 * Protected — returns the currently authenticated user's profile.
 */
router.get('/me', authenticate, catchAsync(authController.getMe));

/**
 * PATCH /api/auth/me
 * Protected — any authenticated user can update their own name/email/password.
 * Role changes are NOT allowed here (ADMIN-only via /api/users).
 */
router.patch(
  '/me',
  authenticate,
  validate(updateProfileSchema),
  catchAsync(authController.updateMe),
);

export default router;