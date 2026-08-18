/**
 * Idempotency — Part 11
 *
 * Protects write endpoints from duplicate client requests.
 *
 * Flow:
 *   1. Client sends POST with header: Idempotency-Key: <uuid>
 *   2. Middleware hashes method + path + body → requestHash.
 *   3. Check IdempotencyKey table:
 *        - Not found → execute handler, store response, return response.
 *        - Found, same hash → replay stored response.
 *        - Found, different hash → return 409 (key reuse with different body).
 *   4. On successful handler: persist IdempotencyKey with TTL.
 *
 * TTL: keys expire after IDEMPOTENCY_TTL_SECONDS (default 24h).
 *      Expired keys must be pruned externally (cron or Prisma cleanup).
 *
 * Scope:
 *   Applied only to endpoints that opt-in:
 *     POST /api/incidents
 *     POST /api/assignments
 *     POST /api/assignments/:id/reoptimize
 */

import { createHash } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import httpStatus from 'http-status';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import config from '../config';
import logger from '../lib/logger';

// ─── Header name ─────────────────────────────────────────────────────────────

export const IDEMPOTENCY_HEADER = 'idempotency-key';

// ─── Hash helper ─────────────────────────────────────────────────────────────

function buildRequestHash(method: string, path: string, body: unknown): string {
  const canonical = JSON.stringify({ method: method.toUpperCase(), path, body });
  return createHash('sha256').update(canonical).digest('hex');
}

// ─── Cleanup helper (exported for scheduled jobs) ────────────────────────────

export async function pruneExpiredIdempotencyKeys(): Promise<number> {
  const result = await prisma.idempotencyKey.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}

// ─── Express middleware ───────────────────────────────────────────────────────

/**
 * idempotency
 *
 * Express middleware factory. Wrap a route with this to add idempotency
 * protection. The actual route handler runs only once per unique key.
 *
 * Usage:
 *   router.post('/', authenticate, idempotency(), validate(schema), catchAsync(handler));
 *
 * The middleware intercepts res.json() to capture the response body so it
 * can be stored and replayed on retries.
 */
export function idempotency() {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const rawKey = req.headers[IDEMPOTENCY_HEADER];

    // No header → bypass (endpoint still works without idempotency)
    if (!rawKey || typeof rawKey !== 'string' || rawKey.trim() === '') {
      next();
      return;
    }

    const key = rawKey.trim();
    const requestHash = buildRequestHash(req.method, req.path, req.body);

    // Check existing record
    const existing = await prisma.idempotencyKey.findUnique({ where: { key } });

    if (existing) {
      // Expired → treat as if not found (allow re-use)
      if (existing.expiresAt < new Date()) {
        await prisma.idempotencyKey.delete({ where: { key } });
        // Fall through to execute the request normally
      } else if (existing.requestHash !== requestHash) {
        // Same key, different body → conflict
        res.status(httpStatus.CONFLICT).json({
          success:   false,
          message:   'Idempotency key was already used with a different request body.',
          errorCode: 'IDEMPOTENCY_KEY_REUSE_CONFLICT',
          requestId: (req as Request & { requestId?: string }).requestId,
        });
        return;
      } else {
        // Same key, same body → replay stored response
        res.status(existing.responseStatus).json(existing.responseBody);
        return;
      }
    }

    // ─── Intercept res.json to capture the response ─────────────────────────
    const originalJson = res.json.bind(res);

    // Track the final status code via res.status override
    let capturedStatus = 200;
    const originalStatus = res.status.bind(res);
    res.status = (code: number): Response => {
      capturedStatus = code;
      return originalStatus(code);
    };

    res.json = (body: unknown): Response => {
      // Only store on success responses (2xx) to avoid caching error states
      if (capturedStatus >= 200 && capturedStatus < 300) {
        const expiresAt = new Date(
          Date.now() + config.idempotencyTtlSeconds * 1000,
        );

        prisma.idempotencyKey
          .create({
            data: {
              key,
              requestHash,
              responseStatus: capturedStatus,
              responseBody:   body as Prisma.InputJsonValue,
              expiresAt,
            },
          })
          .catch((err: Error) => {
            logger.error('[Idempotency] Failed to persist key', {
              operation: 'idempotencyPersist',
              key,
              message: err.message,
            });
          });
      }

      return originalJson(body);
    };

    next();
  };
}
