import bcrypt from 'bcryptjs';
import httpStatus from 'http-status';
import prisma from '../lib/prisma';
import { AppError } from '../utils/errors';
import { signToken } from '../utils/jwt';
import {
  RegisterInput,
  LoginInput,
  SafeUser,
  LoginResponse,
  UpdateProfileInput,
} from './auth.interface';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SALT_ROUNDS = 12;

/**
 * Strip the password field before returning user data to any caller.
 * This is enforced structurally: SafeUser has no password property.
 */
const toSafeUser = (user: {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  password: string;
}): SafeUser => {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as SafeUser['role'],
    status: user.status as SafeUser['status'],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * register
 *
 * Creates a new user account.
 * Only CITIZEN role can self-register.
 * ADMIN, COORDINATOR, OPERATOR accounts must be created by an ADMIN
 * via the /api/users endpoint.
 */
export const register = async (input: RegisterInput): Promise<SafeUser> => {
  const { name, email, password } = input;

  // 1. Guard: reject duplicate emails
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError(
      'An account with this email already exists.',
      httpStatus.CONFLICT,
    );
  }

  // 2. RBAC: only CITIZEN can self-register.
  //    ADMIN/COORDINATOR/OPERATOR accounts are created by ADMIN via /api/users.

  // 3. Hash password — never store plain-text
  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  // 4. Persist — always CITIZEN role
  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role: 'CITIZEN',
    },
  });

  return toSafeUser(user);
};

/**
 * login
 *
 * Validates credentials and returns a signed JWT + safe user profile.
 * A deliberately vague error message prevents email enumeration.
 */
export const login = async (input: LoginInput): Promise<LoginResponse> => {
  const { email, password } = input;

  // 1. Find user — include password for comparison only
  const user = await prisma.user.findUnique({ where: { email } });

  // Constant-time dummy comparison when user doesn't exist
  // prevents timing-based email enumeration attacks.
  const DUMMY_HASH =
    '$2a$12$iqJSHD.BGr0E2IxQwYgJmeP3NvhPrXAeLSaGCj6IR/XU5QtjVu5Tm';
  const passwordToCheck = user?.password ?? DUMMY_HASH;
  const passwordMatch = await bcrypt.compare(password, passwordToCheck);

  if (!user || !passwordMatch) {
    throw new AppError('Invalid email or password.', httpStatus.UNAUTHORIZED);
  }

  // 2. Guard: inactive accounts cannot log in
  if (user.status === 'INACTIVE') {
    throw new AppError(
      'Your account has been deactivated. Please contact support.',
      httpStatus.FORBIDDEN,
    );
  }

  // 3. Issue JWT — payload contains only non-sensitive identifiers
  const token = signToken({ userId: user.id, role: user.role });

  return {
    token,
    user: toSafeUser(user),
  };
};

/**
 * getMe
 *
 * Fetches the currently authenticated user by their ID.
 */
export const getMe = async (userId: string): Promise<SafeUser> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new AppError('User not found.', httpStatus.NOT_FOUND);
  }

  return toSafeUser(user);
};

/**
 * updateMe
 *
 * Allows any authenticated user to update their own profile.
 * CITIZEN can update name, email, password.
 * Role cannot be changed here — only ADMIN can change roles via /api/users.
 */
export const updateMe = async (
  userId: string,
  input: UpdateProfileInput,
): Promise<SafeUser> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError('User not found.', httpStatus.NOT_FOUND);
  }

  // Guard: email uniqueness check if changing email
  if (input.email && input.email !== user.email) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new AppError(
        'An account with this email already exists.',
        httpStatus.CONFLICT,
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data['name'] = input.name;
  if (input.email !== undefined) data['email'] = input.email;
  if (input.password !== undefined) {
    data['password'] = await bcrypt.hash(input.password, SALT_ROUNDS);
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
  });

  return toSafeUser(updated);
};