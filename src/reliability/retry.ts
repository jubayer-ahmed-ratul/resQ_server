/**
 * Retry utility — Part 11
 *
 * Retries an async operation with exponential backoff + optional jitter.
 *
 * Retry only on transient errors (network timeout, connection reset, etc.).
 * Never retry validation, auth, or permanent business conflicts.
 *
 * Formula: delay = min(initialDelay * 2^(attempt-1) + jitter, maxDelay)
 */

import config from '../config';
import logger from '../lib/logger';

// ─── Error classification ─────────────────────────────────────────────────────

const TRANSIENT_MESSAGES = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'socket hang up',
  'connection timeout',
  'connection refused',
  'too many connections',
  'deadlock',
  'EPIPE',
];

/**
 * isTransientError
 * Returns true if an error looks like a temporary infrastructure problem
 * that is safe to retry.
 */
export function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return TRANSIENT_MESSAGES.some((pattern) => msg.includes(pattern.toLowerCase()));
}

// ─── Backoff calculation ──────────────────────────────────────────────────────

/**
 * calculateBackoff
 * Returns the delay (ms) for a given attempt number (1-indexed).
 * Adds up to 10% random jitter to avoid thundering-herd when multiple
 * clients retry simultaneously.
 */
export function calculateBackoff(
  attempt: number,
  initialDelay = config.retry.initialDelay,
  maxDelay = config.retry.maxDelay,
): number {
  const base = initialDelay * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * base * 0.1);
  return Math.min(base + jitter, maxDelay);
}

// ─── Sleep helper ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Retry options ────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: config.retry.maxAttempts */
  maxAttempts?: number;
  /** Initial backoff delay in ms. Default: config.retry.initialDelay */
  initialDelay?: number;
  /** Maximum backoff delay in ms. Default: config.retry.maxDelay */
  maxDelay?: number;
  /**
   * Custom predicate to decide whether to retry.
   * If omitted, uses isTransientError().
   */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Optional label for logging. */
  operationName?: string;
}

// ─── withRetry ────────────────────────────────────────────────────────────────

/**
 * withRetry
 *
 * Executes `fn` and retries on transient failures up to `maxAttempts` times.
 * Throws the last error if all attempts are exhausted.
 *
 * @example
 *   const result = await withRetry(() => prisma.incident.findMany(), {
 *     operationName: 'fetchIncidents',
 *   });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? config.retry.maxAttempts;
  const initialDelay = options.initialDelay ?? config.retry.initialDelay;
  const maxDelay = options.maxDelay ?? config.retry.maxDelay;
  const shouldRetry = options.shouldRetry ?? isTransientError;
  const label = options.operationName ?? 'operation';

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts || !shouldRetry(err, attempt)) {
        // Either exhausted attempts or non-transient error — give up
        break;
      }

      const delay = calculateBackoff(attempt, initialDelay, maxDelay);
      logger.warn(`[Retry] Operation failed — retrying`, {
        operation: label,
        attempt,
        maxAttempts,
        retryDelayMs: delay,
        message: (err as Error).message,
      });

      await sleep(delay);
    }
  }

  throw lastError;
}
