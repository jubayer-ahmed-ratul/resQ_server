/**
 * Request ID middleware — Part 11
 *
 * Attaches a unique request ID to every incoming request.
 *
 * Strategy:
 *   1. Accept X-Request-Id from the client if provided (useful for tracing
 *      across services that already assigned an ID upstream).
 *   2. Generate a fresh UUID v4 if the header is absent or empty.
 *   3. Attach to req.requestId for use in handlers and logs.
 *   4. Echo back in the X-Request-Id response header so clients can
 *      correlate their request with server-side logs.
 *
 * The requestId is separate from eventId — they serve different purposes:
 *   requestId  → HTTP request tracing
 *   eventId    → domain event identity / idempotency key in the event system
 */

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

// Augment Express Request with requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers['x-request-id'];
  const requestId =
    typeof incoming === 'string' && incoming.trim() !== ''
      ? incoming.trim()
      : randomUUID();

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
