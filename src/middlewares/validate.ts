import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import httpStatus from 'http-status';

/**
 * Express middleware factory that validates req.body against a Zod schema.
 *
 * On failure it returns a 400 with a structured list of field-level errors
 * so the client knows exactly what to fix.
 */
const validate =
  (schema: ZodSchema) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const zodError = result.error as ZodError;
      const errors = zodError.issues.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));

      res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
      return;
    }

    // Replace req.body with the parsed (and type-coerced) data
    req.body = result.data;
    next();
  };

export default validate;
