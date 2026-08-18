import jwt from 'jsonwebtoken';
import config from '../config';
import { AppError } from './errors';
import httpStatus from 'http-status';

export interface JwtPayload {
  userId: string;
  role: string;
}

/**
 * Signs a JWT with the application secret.
 * Only non-sensitive identifiers go into the payload.
 */
export const signToken = (payload: JwtPayload): string => {
  const secret = config.jwt.secret;

  if (!secret) {
    throw new AppError(
      'JWT secret is not configured.',
      httpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  return jwt.sign(payload, secret, {
    expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'],
  });
};

/**
 * Verifies a JWT and returns its decoded payload.
 * Throws an AppError for invalid or expired tokens.
 */
export const verifyToken = (token: string): JwtPayload => {
  const secret = config.jwt.secret;

  if (!secret) {
    throw new AppError(
      'JWT secret is not configured.',
      httpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  try {
    const decoded = jwt.verify(token, secret) as JwtPayload;
    return decoded;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError('Token has expired. Please log in again.', httpStatus.UNAUTHORIZED);
    }
    throw new AppError('Invalid token. Please log in again.', httpStatus.UNAUTHORIZED);
  }
};
