import { Response } from 'express';

interface SendResponseOptions<T> {
  res: Response;
  statusCode: number;
  success: boolean;
  message: string;
  data?: T;
}

/**
 * Sends a consistent JSON response shape across all endpoints.
 *
 * Success:  { success: true,  message, data }
 * Error:    { success: false, message }       ← handled by errorHandler
 */
const sendResponse = <T>({
  res,
  statusCode,
  success,
  message,
  data,
}: SendResponseOptions<T>): void => {
  const body: Record<string, unknown> = { success, message };

  if (data !== undefined) {
    body['data'] = data;
  }

  res.status(statusCode).json(body);
};

export default sendResponse;
