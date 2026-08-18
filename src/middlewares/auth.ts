import { Request, Response, NextFunction } from 'express';
import httpStatus from 'http-status';
import { verifyToken, JwtPayload } from '../utils/jwt';
import { AppError } from '../utils/errors';

// ─── Extend Express Request ───────────────────────────────────────────────────

/**
 * Attach the authenticated user's identity to every request that passes
 * through the authenticate middleware.  Downstream handlers can read
 * req.user without casting to `any`.
 */
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export interface AuthUser {
  userId: string;
  role: string;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * authenticate
 *
 * Reads the Bearer token from the Authorization header, verifies it,
 * and attaches the decoded payload to req.user.
 *
 * Strategy: Authorization header only (Bearer token).
 * This keeps the API stateless and works cleanly with REST clients,
 * mobile apps, and server-to-server calls — no cookie complexity needed
 * for an emergency-response API consumed by heterogeneous clients.
 */
export const authenticate = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(
      new AppError(
        'Authentication required. Please provide a valid token.',
        httpStatus.UNAUTHORIZED,
      ),
    );
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    return next(
      new AppError('Malformed authorization header.', httpStatus.UNAUTHORIZED),
    );
  }

  try {
    const decoded: JwtPayload = verifyToken(token);
    req.user = { userId: decoded.userId, role: decoded.role };
    next();
  } catch (err) {
    next(err);
  }
};

// ─── Role Authorization ───────────────────────────────────────────────────────

/**
 * authorizeRoles(...roles)
 *
 * Factory that returns a middleware allowing only users whose role
 * appears in the provided list.
 *
 * Must always be used AFTER authenticate:
 *   router.get('/admin-only', authenticate, authorizeRoles('ADMIN'), handler)
 */
export const authorizeRoles = (...roles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(
        new AppError(
          'Authentication required.',
          httpStatus.UNAUTHORIZED,
        ),
      );
    }

    if (!roles.includes(req.user.role)) {
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
