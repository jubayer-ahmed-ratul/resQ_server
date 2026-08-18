import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async route handler and forwards any thrown error to Express's
 * next() so the global error handler can process it.
 *
 * Without this, an unhandled promise rejection in a route handler would
 * crash the process instead of returning a proper error response.
 */
const catchAsync = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
};

export default catchAsync;
