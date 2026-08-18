/**
 * Timeout utility — Part 11
 *
 * Wraps an async operation with a hard timeout.
 * If the operation does not resolve within `timeoutMs`, the promise rejects
 * with a DependencyTimeoutError — never hangs indefinitely.
 */

import httpStatus from 'http-status';
import { AppError } from '../utils/errors';

// ─── Timeout error ────────────────────────────────────────────────────────────

export class DependencyTimeoutError extends AppError {
  constructor(dependencyName: string, timeoutMs: number) {
    super(
      `Dependency "${dependencyName}" did not respond within ${timeoutMs}ms.`,
      httpStatus.GATEWAY_TIMEOUT,
    );
  }
}

// ─── withTimeout ─────────────────────────────────────────────────────────────

/**
 * withTimeout
 *
 * Races `fn` against a timer. If the timer fires first, rejects with
 * DependencyTimeoutError. Does NOT cancel the original promise (JavaScript
 * does not support true cancellation without AbortController), but the
 * caller receives the error immediately so it can move on.
 *
 * @param fn            The async operation to execute.
 * @param timeoutMs     Maximum allowed duration in milliseconds.
 * @param dependencyName  Human-readable name for logging/errors.
 *
 * @example
 *   const user = await withTimeout(
 *     () => externalAuthService.verify(token),
 *     5000,
 *     'AuthService',
 *   );
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  dependencyName: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new DependencyTimeoutError(dependencyName, timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([fn(), timeoutPromise]);
    return result;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

// ─── withTimeoutAndRetry ──────────────────────────────────────────────────────

import { withRetry, RetryOptions } from './retry';

/**
 * withTimeoutAndRetry
 *
 * Combines timeout + retry. Each individual attempt has its own timeout.
 * Retries are only performed for transient errors (including timeout).
 */
export async function withTimeoutAndRetry<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  dependencyName: string,
  retryOptions: RetryOptions = {},
): Promise<T> {
  return withRetry(
    () => withTimeout(fn, timeoutMs, dependencyName),
    {
      ...retryOptions,
      shouldRetry: (err, attempt) => {
        if (err instanceof DependencyTimeoutError) return true;
        return (retryOptions.shouldRetry ?? (() => false))(err, attempt);
      },
    },
  );
}
