import bcrypt from 'bcryptjs';
import httpStatus from 'http-status';
import prisma from '../../lib/prisma';
import { AppError } from '../../utils/errors';
import {
  CreateUserInput,
  UpdateUserInput,
  UserFilters,
  SafeUser,
} from './user.interface';
import { PaginationParams, PaginatedResult, buildPaginationMeta } from '../../utils/pagination';

const SALT_ROUNDS = 12;

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

/**
 * Create a user — ADMIN only.
 */
export const createUser = async (input: CreateUserInput): Promise<SafeUser> => {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError('An account with this email already exists.', httpStatus.CONFLICT);
  }

  const hashedPassword = await bcrypt.hash(input.password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      password: hashedPassword,
      role: input.role,
    },
  });

  return toSafeUser(user);
};

/**
 * List users — ADMIN only.
 */
export const getUsers = async (
  filters: UserFilters,
  pagination: PaginationParams,
): Promise<PaginatedResult<SafeUser>> => {
  const where: Record<string, unknown> = {};
  if (filters.role) where['role'] = filters.role;
  if (filters.status) where['status'] = filters.status;

  const { skip, take } = buildPaginationMeta(pagination);

  const [total, items] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return {
    data: items as SafeUser[],
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
      hasNextPage: pagination.page * pagination.limit < total,
      hasPrevPage: pagination.page > 1,
    },
  };
};

/**
 * Get a single user — ADMIN only.
 */
export const getUserById = async (id: string): Promise<SafeUser> => {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!user) {
    throw new AppError('User not found.', httpStatus.NOT_FOUND);
  }
  return user as SafeUser;
};

/**
 * Update a user — ADMIN only.
 */
export const updateUser = async (
  id: string,
  input: UpdateUserInput,
): Promise<SafeUser> => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new AppError('User not found.', httpStatus.NOT_FOUND);
  }

  // If email is being changed, check for conflicts
  if (input.email && input.email !== user.email) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new AppError('An account with this email already exists.', httpStatus.CONFLICT);
    }
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data['name'] = input.name;
  if (input.email !== undefined) data['email'] = input.email;
  if (input.role !== undefined) data['role'] = input.role;
  if (input.status !== undefined) data['status'] = input.status;
  if (input.password !== undefined) {
    data['password'] = await bcrypt.hash(input.password, SALT_ROUNDS);
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return updated as SafeUser;
};

/**
 * Deactivate a user — ADMIN only.
 */
export const deactivateUser = async (id: string): Promise<SafeUser> => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new AppError('User not found.', httpStatus.NOT_FOUND);
  }
  if (user.role === 'ADMIN') {
    throw new AppError('Cannot deactivate an ADMIN account.', httpStatus.BAD_REQUEST);
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { status: 'INACTIVE' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return updated as SafeUser;
};

/**
 * Activate a user — ADMIN only.
 */
export const activateUser = async (id: string): Promise<SafeUser> => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new AppError('User not found.', httpStatus.NOT_FOUND);
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return updated as SafeUser;
};