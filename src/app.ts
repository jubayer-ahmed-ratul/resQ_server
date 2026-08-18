/**
 * Express Application — Part 11 updated
 *
 * Changes from Part 10:
 *   - helmet for security headers
 *   - requestId middleware on every request
 *   - Configurable CORS origins (no wildcard in production)
 *   - JSON body size limit
 *   - General rate limiting on all API routes
 *   - Stricter rate limiting on auth endpoints
 *   - Replaced simple /health with dedicated health router (/health + /ready)
 *   - Updated error handler with errorCode + requestId
 */

import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import httpStatus from 'http-status';

import config from './config';
import errorHandler from './middlewares/errorHandler';
import { requestIdMiddleware } from './middlewares/requestId.middleware';
import { distributedGeneralRateLimit, distributedAuthRateLimit, distributedExpensiveRateLimit } from './middlewares/rateLimit.middleware';

import healthRouter from './health/health.route';
import authRouter from './auth/auth.route';
import incidentRouter from './modules/incident/incident.route';
import resourceRouter from './modules/resource/resource.route';
import hospitalRouter from './modules/hospital/hospital.route';
import assignmentRouter from './modules/assignment/assignment.route';
import decisionRouter from './modules/decision/decision.route';
import reoptimizationRouter from './modules/reoptimization/reoptimization.route';

const app = express();

// ─── Security headers (Helmet) ────────────────────────────────────────────────
// Must be first to ensure headers are set on all responses.

app.use(helmet());

// ─── CORS ────────────────────────────────────────────────────────────────────
// In production use CORS_ORIGINS from env; never allow '*' for authenticated APIs.

app.use(
  cors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'Idempotency-Key',
    ],
    credentials: true,
  }),
);

// ─── Core middleware ─────────────────────────────────────────────────────────

// Limit JSON body to 1 MB — prevents oversized payload attacks
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ─── Request ID ───────────────────────────────────────────────────────────────
// Every request gets a unique ID, echoed in X-Request-Id response header.
// Must come before routes so req.requestId is available in handlers + error handler.

app.use(requestIdMiddleware);

// ─── Health / Readiness (no rate limiting on health endpoints) ────────────────

app.use(healthRouter);

// ─── General API rate limiter ─────────────────────────────────────────────────
// Use distributed (Redis-backed) rate limiter when running multiple instances.
// Falls back to in-process automatically when Redis is unavailable.

app.use('/api', distributedGeneralRateLimit);

// ─── Routes ───────────────────────────────────────────────────────────────────

// Auth — stricter rate limit to prevent brute-force
app.use('/api/auth', distributedAuthRateLimit, authRouter);

// Incident routes
app.use('/api/incidents', incidentRouter);

// Resource routes
app.use('/api/resources', resourceRouter);

// Hospital routes
app.use('/api/hospitals', hospitalRouter);

// Assignment routes
app.use('/api/assignments', assignmentRouter);

// Decision log routes
app.use('/api/decisions', decisionRouter);

// Re-optimization log routes — expensive operations get additional throttle
app.use('/api/reoptimizations', distributedExpensiveRateLimit, reoptimizationRouter);

// ─── 404 handler ─────────────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(httpStatus.NOT_FOUND).json({
    success:   false,
    message:   'The requested endpoint does not exist.',
    errorCode: 'NOT_FOUND',
  });
});

// ─── Global error handler ─────────────────────────────────────────────────────
// Must be registered after all routes and the 404 handler.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  errorHandler(err, req, res, next);
});

export default app;
