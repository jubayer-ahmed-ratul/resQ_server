/**
 * AppError — a structured, catchable error for known application failures.
 *
 * Use this when you want the global error handler to return a specific
 * HTTP status code and message to the client instead of a generic 500.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);

    this.statusCode = statusCode;
    // Operational errors are anticipated failures (bad input, not found, etc.)
    // that should be surfaced to the client. Non-operational errors are bugs.
    this.isOperational = true;

    // Maintain correct prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);

    // Capture a clean stack trace excluding the constructor call
    Error.captureStackTrace(this, this.constructor);
  }
}
