import { Request, Response, NextFunction } from 'express';
import httpStatus from 'http-status';
import { AppError } from '../utils/errors';
import prisma from '../lib/prisma';

/**
 * Role-based permission enforcement for the backend.
 *
 * This middleware MUST be used AFTER `authenticate`. It performs both
 * role checks and permanent ownership checks (for OPERATOR-only resources).
 *
 * Core rule:
 *   ADMIN      → Everything
 *   COORDINATOR→ Incident + assignment management
 *   OPERATOR   → Only assigned resource/hospital operations
 *   CITIZEN    → Only own profile + own emergency reports
 */

export type Role = 'ADMIN' | 'COORDINATOR' | 'OPERATOR' | 'CITIZEN';

export const ROLES: Record<Role, Role> = {
  ADMIN: 'ADMIN',
  COORDINATOR: 'COORDINATOR',
  OPERATOR: 'OPERATOR',
  CITIZEN: 'CITIZEN',
};

/**
 * Allow only the given roles. Must be used after `authenticate`.
 */
export const requireRoles = (...roles: Role[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(
        new AppError('Authentication required.', httpStatus.UNAUTHORIZED),
      );
    }
    if (!roles.includes(req.user.role as Role)) {
      return next(
        new AppError(
          'You do not have permission to perform this action.',
          httpStatus.FORBIDDEN,
        ),
      );
    }
    next();
  };
};

/**
 * Alias that reads more naturally for a single allowed role.
 */
export const requireRole = (role: Role) => requireRoles(role);

// ─── Ownership checks (OPERATOR) ──────────────────────────────────────────────

/**
 * Guard for RESOURCE operations.
 * ADMIN: full access.
 * COORDINATOR: read access (view resources — no ownership restriction).
 * OPERATOR: resource.operatorId === user (own resource only).
 * CITIZEN: denied.
 */
export const requireResourceAccess = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.user) {
    return next(new AppError('Authentication required.', httpStatus.UNAUTHORIZED));
  }
  const role = req.user.role as Role;
  if (role === 'ADMIN') return next();
  if (role === 'COORDINATOR') return next(); // COORDINATOR can view all resources
  if (role === 'CITIZEN') {
    return next(new AppError('You do not have permission to perform this action.', httpStatus.FORBIDDEN));
  }
  const resourceId = req.params['id'];
  if (!resourceId) {
    return next(new AppError('Resource id is required.', httpStatus.BAD_REQUEST));
  }
  if (role === 'OPERATOR') {
    const resource = await prisma.resource.findUnique({
      where: { id: resourceId },
      select: { operatorId: true },
    });
    if (!resource) return next(new AppError('Resource not found.', httpStatus.NOT_FOUND));
    if (resource.operatorId !== req.user.userId) {
      return next(new AppError('You do not have permission to access this resource.', httpStatus.FORBIDDEN));
    }
    return next();
  }
  return next(new AppError('You do not have permission to perform this action.', httpStatus.FORBIDDEN));
};

/**
 * Guard for HOSPITAL operations.
 * ADMIN: full. OPERATOR: assignedOperatorId === user. COORDINATOR: read-only. CITIZEN: denied.
 */
export const requireHospitalAccess = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.user) {
    return next(new AppError('Authentication required.', httpStatus.UNAUTHORIZED));
  }
  const role = req.user.role as Role;
  if (role === 'ADMIN') return next();
  if (role === 'CITIZEN') {
    return next(new AppError('You do not have permission to perform this action.', httpStatus.FORBIDDEN));
  }
  const hospitalId = req.params['id'];
  if (!hospitalId) {
    return next(new AppError('Hospital id is required.', httpStatus.BAD_REQUEST));
  }
  if (role === 'OPERATOR') {
    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { assignedOperatorId: true },
    });
    if (!hospital) return next(new AppError('Hospital not found.', httpStatus.NOT_FOUND));
    if (hospital.assignedOperatorId !== req.user.userId) {
      return next(new AppError('You do not have permission to access this hospital.', httpStatus.FORBIDDEN));
    }
    return next();
  }
  if (role === 'COORDINATOR') return next();
  return next(new AppError('You do not have permission to perform this action.', httpStatus.FORBIDDEN));
};

/**
 * Guard for ASSIGNMENT operations.
 * ADMIN/COORDINATOR: full. OPERATOR: resource.operatorId === user. CITIZEN: own incident's assignments only.
 */
export const requireAssignmentAccess = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.user) {
    return next(new AppError('Authentication required.', httpStatus.UNAUTHORIZED));
  }
  const role = req.user.role as Role;
  if (role === 'ADMIN' || role === 'COORDINATOR') return next();

  const assignmentId = req.params['id'];
  if (!assignmentId) {
    return next(new AppError('Assignment id is required.', httpStatus.BAD_REQUEST));
  }

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      resource: { select: { operatorId: true } },
      incident: { select: { createdById: true } },
    },
  });
  if (!assignment) return next(new AppError('Assignment not found.', httpStatus.NOT_FOUND));

  if (role === 'OPERATOR') {
    if (assignment.resource.operatorId !== req.user.userId) {
      return next(new AppError('You do not have permission to access this assignment.', httpStatus.FORBIDDEN));
    }
    return next();
  }

  if (role === 'CITIZEN') {
    // CITIZEN can only view assignments for their own incidents (read-only updates)
    if (assignment.incident.createdById !== req.user.userId) {
      return next(new AppError('You do not have permission to access this assignment.', httpStatus.FORBIDDEN));
    }
    return next();
  }

  return next(new AppError('You do not have permission to perform this action.', httpStatus.FORBIDDEN));
};

/**
 * Guard for INCIDENT access.
 * ADMIN/COORDINATOR: full. OPERATOR: active assignment with their resource. CITIZEN: own only.
 */
export const requireIncidentAccess = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.user) {
    return next(new AppError('Authentication required.', httpStatus.UNAUTHORIZED));
  }
  const role = req.user.role as Role;
  if (role === 'ADMIN' || role === 'COORDINATOR') return next();
  const incidentId = req.params['id'];
  if (!incidentId) {
    return next(new AppError('Incident id is required.', httpStatus.BAD_REQUEST));
  }
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { createdById: true },
  });
  if (!incident) return next(new AppError('Incident not found.', httpStatus.NOT_FOUND));
  if (role === 'OPERATOR') {
    const assignment = await prisma.assignment.findFirst({
      where: { incidentId, status: 'ACTIVE', resource: { operatorId: req.user.userId } },
      select: { id: true },
    });
    if (!assignment) {
      return next(new AppError('You do not have permission to access this incident.', httpStatus.FORBIDDEN));
    }
    return next();
  }
  if (role === 'CITIZEN') {
    if (incident.createdById !== req.user.userId) {
      return next(new AppError('You do not have permission to access this incident.', httpStatus.FORBIDDEN));
    }
    return next();
  }
  return next(new AppError('You do not have permission to perform this action.', httpStatus.FORBIDDEN));
};