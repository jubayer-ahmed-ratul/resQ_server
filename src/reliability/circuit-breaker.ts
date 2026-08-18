/**
 * Circuit Breaker — Part 11
 *
 * Per-dependency circuit breaker implementing the standard three-state model:
 *
 *   CLOSED   → normal operation; failures are counted.
 *   OPEN     → fast-fail; no requests reach the dependency.
 *   HALF_OPEN → test mode; one request is allowed through.
 *              Success → CLOSED.  Failure → OPEN.
 *
 * Design:
 *   - One CircuitBreaker instance per external dependency.
 *   - Do NOT create one global breaker for the entire application.
 *   - Configuration via constructor or defaults from config.
 *   - Pure in-process state — no external state store required at this scale.
 */

import config from '../config';
import httpStatus from 'http-status';
import { AppError } from '../utils/errors';
import logger from '../lib/logger';

// ─── States ───────────────────────────────────────────────────────────────────

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

// ─── Circuit open error ───────────────────────────────────────────────────────

export class CircuitOpenError extends AppError {
  public readonly dependency: string;
  constructor(dependency: string) {
    super(
      `Service "${dependency}" is temporarily unavailable (circuit OPEN). ` +
      `Please retry later.`,
      httpStatus.SERVICE_UNAVAILABLE,
    );
    this.dependency = dependency;
  }
}

// ─── Options ─────────────────────────────────────────────────────────────────

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening. Default: config value. */
  failureThreshold?: number;
  /**
   * How long (ms) to wait in OPEN state before moving to HALF_OPEN.
   * Default: config value.
   */
  resetTimeout?: number;
  /** Human-readable name for this breaker (used in logs/errors). */
  name: string;
}

// ─── CircuitBreaker class ─────────────────────────────────────────────────────

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  public readonly name: string;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold =
      options.failureThreshold ?? config.circuitBreaker.failureThreshold;
    this.resetTimeout =
      options.resetTimeout ?? config.circuitBreaker.resetTimeout;
  }

  // ─── Public state accessors ─────────────────────────────────────────────────

  getState(): CircuitState {
    this.transitionIfNeeded();
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  // ─── Execute ────────────────────────────────────────────────────────────────

  /**
   * execute
   *
   * Runs `fn` through the circuit breaker.
   * - CLOSED: runs normally; tracks failures.
   * - OPEN: throws CircuitOpenError without calling `fn`.
   * - HALF_OPEN: allows one test request; success closes, failure reopens.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.transitionIfNeeded();

    if (this.state === 'OPEN') {
      throw new CircuitOpenError(this.name);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  // ─── State transitions ───────────────────────────────────────────────────────

  private transitionIfNeeded(): void {
    if (
      this.state === 'OPEN' &&
      this.lastFailureTime !== null &&
      Date.now() - this.lastFailureTime >= this.resetTimeout
    ) {
      this.state = 'HALF_OPEN';
      logger.info(`[CircuitBreaker] "${this.name}" → HALF_OPEN (testing recovery)`, {
        operation: 'circuitBreaker',
        dependency: this.name,
        state: 'HALF_OPEN',
      });
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.failureCount = 0;
      this.lastFailureTime = null;
      logger.info(`[CircuitBreaker] "${this.name}" → CLOSED (recovered)`, {
        operation: 'circuitBreaker',
        dependency: this.name,
        state: 'CLOSED',
      });
    } else if (this.state === 'CLOSED') {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      logger.warn(
        `[CircuitBreaker] "${this.name}" → OPEN (HALF_OPEN test failed)`,
        {
          operation: 'circuitBreaker',
          dependency: this.name,
          state: 'OPEN',
          resetTimeoutMs: this.resetTimeout,
        },
      );
      return;
    }

    if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      logger.error(
        `[CircuitBreaker] "${this.name}" → OPEN (failure threshold reached)`,
        {
          operation: 'circuitBreaker',
          dependency: this.name,
          state: 'OPEN',
          failureCount: this.failureCount,
          failureThreshold: this.failureThreshold,
        },
      );
    }
  }

  // ─── Manual reset (for testing / admin operations) ──────────────────────────

  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
  }
}

// ─── Circuit breaker registry ─────────────────────────────────────────────────
// One instance per named dependency. Lazily created on first use.

const _breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(
  name: string,
  options?: Omit<CircuitBreakerOptions, 'name'>,
): CircuitBreaker {
  if (!_breakers.has(name)) {
    _breakers.set(name, new CircuitBreaker({ name, ...options }));
  }
  return _breakers.get(name)!;
}

/** Reset all circuit breakers — useful in tests. */
export function resetAllCircuitBreakers(): void {
  _breakers.forEach((breaker) => breaker.reset());
  _breakers.clear();
}
