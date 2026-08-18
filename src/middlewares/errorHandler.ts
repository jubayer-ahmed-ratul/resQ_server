/**
 * Global Error Handler — Part 11 updated
 *
 * Changes from Part 10:
 *   - Attaches requestId from req.requestId to every error response.
 *   - Adds structured errorCode field.
 *   - Hides stack traces, SQL, and Prisma internals from clients.
 *   - Handles new Part 11 error types (DependencyTimeoutError, CircuitOpenError).
 *   - Never exposes DATABASE_URL, passwords, or connection strings.
 */

import { Request, Response, NextFunction } from 'express';
import httpStatus from 'http-status';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { AppError } from '../utils/errors';
import { DependencyTimeoutError } from '../reliability/timeout';
import { CircuitOpenError } from '../reliability/circuit-breaker';
import logger from '../lib/logger';

// ─── Error codes ──────────────────────────────────────────────────────────────

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DEPENDENCY_TIMEOUT'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'DATABASE_ERROR'
  | 'INTERNAL_ERROR';

function resolveErrorCode(err: Error, statusCode: number): ErrorCode {
  if (err instanceof DependencyTimeoutError) return 'DEPENDENCY_TIMEOUT';
  if (err instanceof CircuitOpenError)       return 'DEPENDENCY_UNAVAILABLE';

  switch (statusCode) {
    case 400: return 'VALIDATION_ERROR';
    case 401: return 'AUTHENTICATION_ERROR';
    case 403: return 'AUTHORIZATION_ERROR';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 429: return 'RATE_LIMITED';
    case 503: return 'DEPENDENCY_UNAVAILABLE';
    case 504: return 'DEPENDENCY_TIMEOUT';
    default:  return 'INTERNAL_ERROR';
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const requestId = req.requestId ?? 'unknown';
  const isProd = process.env['NODE_ENV'] === 'production';

  // 1. Known operational errors (AppError and its subclasses)
  if (err instanceof AppError) {
    const errorCode = resolveErrorCode(err, err.statusCode);
    logger.warn('[ErrorHandler] Operational error', {
      operation: 'errorHandler',
      requestId,
      errorCode,
      status: err.statusCode,
      message: err.message,
    });
    res.status(err.statusCode).json({
      success:   false,
      message:   err.message,
      errorCode,
      requestId,
    });
    return;
  }

  // 2. Prisma unique constraint violation
  if (err instanceof PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      logger.warn('[ErrorHandler] Prisma unique constraint violation', {
        operation: 'errorHandler',
        requestId,
        errorCode: 'CONFLICT',
        prismaCode: err.code,
      });
      res.status(httpStatus.CONFLICT).json({
        success:   false,
        message:   'A record with this value already exists.',
        errorCode: 'CONFLICT' as ErrorCode,
        requestId,
      });
      return;
    }
    // Record not found at DB level
    if (err.code === 'P2025') {
      res.status(httpStatus.NOT_FOUND).json({
        success:   false,
        message:   'The requested record was not found.',
        errorCode: 'NOT_FOUND' as ErrorCode,
        requestId,
      });
      return;
    }
    // Other Prisma DB errors — never expose SQL or internals
    logger.error('[ErrorHandler] Prisma database error', {
      operation: 'errorHandler',
      requestId,
      errorCode: 'DATABASE_ERROR',
      prismaCode: err.code,
      message: err.message,
    });
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success:   false,
      message:   'A database error occurred. Please try again later.',
      errorCode: 'DATABASE_ERROR' as ErrorCode,
      requestId,
    });
    return;
  }

  // 3. Unexpected / unhandled errors
  logger.error('[ErrorHandler] Unhandled error', {
    operation: 'errorHandler',
    requestId,
    errorCode: 'INTERNAL_ERROR',
    message: err.message,
    ...(isProd ? {} : { stack: err.stack }),
  });

  res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
    success:   false,
    message:   'An unexpected error occurred. Please try again later.',
    errorCode: 'INTERNAL_ERROR' as ErrorCode,
    requestId,
    // Never include stack traces in production responses
    ...(isProd ? {} : { detail: err.message }),
  });
};

export default errorHandler;
