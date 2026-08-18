# Requirements Document

## Introduction

Part 11 of the Intelligent Emergency Response & Resource Optimization Platform adds production-grade reliability and operational readiness to the existing Node.js/TypeScript/Express backend. The platform already has Parts 1–10 implemented (foundation, auth, incidents, resources, hospitals, priority engine, resource allocation, assignments, decision logs, re-optimization, and the event/outbox system). This part hardens the system against external dependency failures, prevents data loss during transient outages, adds idempotent write protection for critical endpoints, and exposes the operational observability (health, readiness, security headers, rate limiting, CORS, graceful shutdown) needed to run safely in production.

The reliability layer is confined to `src/reliability/` (retry, timeout, circuit breaker, idempotency) and does not break any existing Parts 1–10 behaviour.

## Glossary

- **System**: The Emergency Response API — the Node.js/TypeScript/Express backend.
- **Dependency**: An external service the System relies on: PostgreSQL (via Prisma), Redis (via ioredis/BullMQ), or any outbound HTTP call.
- **Transient_Error**: A short-lived infrastructure failure (connection reset, timeout, too-many-connections, deadlock) that is expected to self-resolve and is safe to retry.
- **Permanent_Error**: A non-retryable error such as a validation failure, authentication error, or business constraint violation.
- **Circuit_Breaker**: A per-dependency state machine (CLOSED → OPEN → HALF_OPEN) that stops requests from reaching a failing dependency when the failure threshold is exceeded.
- **Idempotency_Key**: A client-supplied UUID (via the `Idempotency-Key` HTTP header) that allows safe retries of write operations without producing duplicate side effects.
- **Request_Hash**: A SHA-256 digest of the HTTP method, path, and request body used to detect key reuse with a different payload.
- **Outbox_Event**: A domain event persisted in the `outbox_events` PostgreSQL table inside the same business transaction, ensuring events are never lost when Redis is temporarily unavailable.
- **Retry**: Automatic re-execution of a failed operation after an exponential backoff delay, applied only to Transient_Errors.
- **Graceful_Shutdown**: The process of draining in-flight requests, closing the HTTP server, flushing queues, and disconnecting from all dependencies before the process exits.
- **Request_ID**: A per-request UUID attached to the `X-Request-Id` HTTP header for tracing and log correlation.
- **Rate_Limiter**: An in-process, per-IP request throttle that rejects excess requests with HTTP 429.
- **Health_Check**: `GET /health` — a liveness probe that always returns 200 while the process is alive.
- **Readiness_Check**: `GET /ready` — a readiness probe that actively checks PostgreSQL and Redis connectivity before reporting the service as ready to receive traffic.

---

## Requirements

### Requirement 1: Timeout Handling for External Dependencies

**User Story:** As a platform operator, I want all calls to external dependencies to have a hard time limit, so that a slow or hung dependency cannot block request processing indefinitely.

#### Acceptance Criteria

1. THE System SHALL apply a configurable timeout (default `HTTP_REQUEST_TIMEOUT=30000 ms`) to every outbound HTTP request.
2. THE System SHALL apply a configurable timeout (default `DATABASE_CONNECTION_TIMEOUT=10000 ms`) to every database query issued via Prisma.
3. THE System SHALL apply a configurable timeout (default `REDIS_CONNECTION_TIMEOUT=5000 ms`) to every Redis operation issued via ioredis/BullMQ.
4. WHEN a dependency call exceeds its configured timeout, THE System SHALL reject the call with a `DependencyTimeoutError` carrying HTTP status 504.
5. THE System SHALL expose `withTimeout(fn, timeoutMs, dependencyName)` in `src/reliability/timeout.ts` as the canonical wrapper for timed operations.
6. THE System SHALL expose `withTimeoutAndRetry(fn, timeoutMs, dependencyName, retryOptions)` for operations that combine timeout enforcement with automatic retry.
7. IF `withTimeoutAndRetry` is used and every attempt times out, THEN THE System SHALL throw a `DependencyTimeoutError` after exhausting all configured retry attempts.

---

### Requirement 2: Retry System with Exponential Backoff and Jitter

**User Story:** As a platform operator, I want transient dependency failures to be automatically retried with increasing delays, so that brief infrastructure blips do not surface as user-facing errors.

#### Acceptance Criteria

1. THE Retry_Module SHALL retry a failed operation only when the error is classified as a Transient_Error.
2. WHEN retrying, THE Retry_Module SHALL wait `min(initialDelay × 2^(attempt−1) + jitter, maxDelay)` milliseconds between consecutive attempts, where jitter is a random value in `[0, baseDelay × 0.1]`.
3. THE Retry_Module SHALL attempt an operation at most `RETRY_MAX_ATTEMPTS` times (including the first attempt; default 3).
4. IF all retry attempts are exhausted, THEN THE Retry_Module SHALL throw the last observed error to the caller without swallowing it.
5. THE Retry_Module SHALL classify the following error message patterns as Transient_Errors: `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `socket hang up`, `connection timeout`, `connection refused`, `too many connections`, `deadlock`, `EPIPE`.
6. THE Retry_Module SHALL NOT retry errors that are not Transient_Errors, including Permanent_Errors such as validation failures and authentication failures.
7. THE Retry_Module SHALL accept a custom `shouldRetry` predicate that overrides the default transient classification.
8. THE Retry_Module SHALL log a warning message on each retry attempt, including the operation name, attempt number, total attempts, delay, and error message.
9. WHEN `RETRY_INITIAL_DELAY` is configured to 0 or below, THE System SHALL reject startup with a configuration error.
10. WHEN `RETRY_MAX_DELAY` is configured below `RETRY_INITIAL_DELAY`, THE System SHALL reject startup with a configuration error.

---

### Requirement 3: Idempotency for Critical Write Operations

**User Story:** As an API consumer, I want to safely retry `POST /incidents`, `POST /assignments`, and `POST /assignments/:id/reoptimize` after network failures, so that my retry does not create duplicate records.

#### Acceptance Criteria

1. THE System SHALL accept an optional `Idempotency-Key` header on `POST /api/incidents`, `POST /api/assignments`, and `POST /api/assignments/:id/reoptimize`.
2. WHEN an `Idempotency-Key` header is present, THE Idempotency_Module SHALL hash the HTTP method, path, and request body using SHA-256 to produce a Request_Hash.
3. WHEN a request arrives with an `Idempotency-Key` that has not been seen before, THE Idempotency_Module SHALL execute the handler and persist the key, Request_Hash, response status, and response body to the `idempotency_keys` table before returning the response.
4. WHEN a request arrives with an `Idempotency-Key` that matches a stored key with the same Request_Hash, THE Idempotency_Module SHALL return the stored response status and body without re-executing the handler.
5. WHEN a request arrives with an `Idempotency-Key` that matches a stored key but with a different Request_Hash, THE Idempotency_Module SHALL return HTTP 409 with `errorCode: "IDEMPOTENCY_KEY_REUSE_CONFLICT"`.
6. THE Idempotency_Module SHALL store idempotency records only for successful responses (HTTP 2xx); non-2xx responses are not cached.
7. WHEN a stored idempotency record's `expiresAt` timestamp is in the past, THE Idempotency_Module SHALL treat the key as new and allow re-use.
8. THE System SHALL configure the idempotency TTL via `IDEMPOTENCY_TTL_SECONDS` (default 86400 seconds / 24 hours).
9. WHEN an `Idempotency-Key` header is absent or empty, THE Idempotency_Module SHALL bypass idempotency checks and pass the request to the handler unmodified.
10. THE System SHALL persist the `IdempotencyKey` model in PostgreSQL via Prisma, including the fields: `key`, `requestHash`, `responseStatus`, `responseBody`, `createdAt`, `expiresAt`.
11. FOR ALL valid write requests with an Idempotency-Key, sending the identical request twice SHALL produce identical response bodies (round-trip idempotency property).

---

### Requirement 4: Circuit Breaker per Dependency

**User Story:** As a platform operator, I want each external dependency to have an independent circuit breaker, so that a failing dependency causes fast-fail errors rather than cascading timeouts that degrade the entire platform.

#### Acceptance Criteria

1. THE Circuit_Breaker SHALL implement three states: CLOSED (normal operation), OPEN (fast-fail), and HALF_OPEN (recovery probe).
2. WHILE in the CLOSED state, THE Circuit_Breaker SHALL count consecutive failures and transition to OPEN when the count reaches `CIRCUIT_BREAKER_FAILURE_THRESHOLD` (default 5).
3. WHILE in the OPEN state, THE Circuit_Breaker SHALL immediately throw a `CircuitOpenError` with HTTP status 503 without executing the wrapped operation.
4. WHEN the circuit has been OPEN for at least `CIRCUIT_BREAKER_RESET_TIMEOUT` milliseconds (default 30000), THE Circuit_Breaker SHALL transition to HALF_OPEN and allow one test request through.
5. WHEN in the HALF_OPEN state and the test request succeeds, THE Circuit_Breaker SHALL transition to CLOSED and reset the failure counter.
6. WHEN in the HALF_OPEN state and the test request fails, THE Circuit_Breaker SHALL transition back to OPEN and restart the reset timer.
7. WHEN a successful request is processed in the CLOSED state, THE Circuit_Breaker SHALL reset the consecutive failure counter to zero.
8. THE System SHALL maintain one Circuit_Breaker instance per named dependency, accessed via `getCircuitBreaker(name)` from `src/reliability/circuit-breaker.ts`.
9. THE System SHALL expose `resetAllCircuitBreakers()` for use in tests.
10. IF `CIRCUIT_BREAKER_FAILURE_THRESHOLD` is configured below 1, THEN THE System SHALL reject startup with a configuration error.

---

### Requirement 5: Graceful Degradation When Optional Dependencies Fail

**User Story:** As a platform operator, I want the API to continue serving reads and writes when Redis is temporarily unavailable, so that a Redis outage does not bring down the entire emergency response platform.

#### Acceptance Criteria

1. WHEN Redis is unavailable during a business write operation, THE System SHALL persist the domain event to the `outbox_events` table (via the Outbox Pattern) rather than returning an error to the caller.
2. WHEN Redis becomes available again, THE Outbox_Publisher SHALL replay all PENDING `outbox_events` to the BullMQ queue in creation-date order.
3. WHILE Redis is unavailable, THE System SHALL continue accepting and processing `GET` and `POST` API requests that do not strictly require Redis.
4. THE Readiness_Check SHALL report Redis status as `degraded` (not `down`) when Redis is unavailable, indicating the API is still partially functional.
5. THE Readiness_Check SHALL report overall status as `degraded` when Redis is `degraded` and the database is `up`, returning HTTP 200 to allow traffic to continue flowing.
6. IF PostgreSQL is unavailable, THEN THE Readiness_Check SHALL report status as `not_ready` and return HTTP 503 to halt new traffic.

---

### Requirement 6: Database Failure Handling

**User Story:** As a platform operator, I want database errors to be handled safely, so that internal connection strings, SQL statements, and schema details are never exposed in API responses.

#### Acceptance Criteria

1. THE Error_Handler SHALL distinguish Prisma error code `P2002` (unique constraint violation) and return HTTP 409 with `errorCode: "CONFLICT"`.
2. THE Error_Handler SHALL distinguish Prisma error code `P2025` (record not found) and return HTTP 404 with `errorCode: "NOT_FOUND"`.
3. WHEN any other Prisma database error occurs, THE Error_Handler SHALL return HTTP 500 with `errorCode: "DATABASE_ERROR"` and a generic user message, without including the SQL statement, connection string, or Prisma error meta in the response body.
4. THE Error_Handler SHALL log the Prisma error code and the `requestId` server-side before returning the sanitised response.
5. WHEN a database connection timeout is exceeded (from `withTimeout`), THE Error_Handler SHALL surface `errorCode: "DEPENDENCY_TIMEOUT"` with HTTP 504.
6. THE System SHALL never include the value of `DATABASE_URL` or any database password in any log line or HTTP response.

---

### Requirement 7: Redis Failure Handling and Data Preservation

**User Story:** As a platform operator, I want domain events to survive a Redis outage without data loss, so that all events are eventually delivered once Redis recovers.

#### Acceptance Criteria

1. THE Outbox_Publisher SHALL poll the `outbox_events` table every `OUTBOX_POLL_INTERVAL_MS` milliseconds for events with `status = 'PENDING'` and `attempts < 5`.
2. WHEN publishing an outbox event to BullMQ fails, THE Outbox_Publisher SHALL increment the `attempts` counter and leave the status as `PENDING` for the next poll cycle.
3. WHEN an outbox event reaches 5 failed publish attempts, THE Outbox_Publisher SHALL set its status to `FAILED` and cease retrying it automatically.
4. THE Outbox_Publisher SHALL process at most 50 pending events per poll cycle to prevent memory spikes.
5. WHEN Redis is unavailable but PostgreSQL is available, THE System SHALL continue writing `outbox_events` with `status = 'PENDING'`; no domain event SHALL be silently dropped.
6. THE System SHALL write `outbox_events` inside the same Prisma transaction as the business operation they describe, ensuring atomicity between the business change and event registration.

---

### Requirement 8: Worker Failure Handling

**User Story:** As a platform operator, I want background job failures to be automatically recoverable, so that transient errors during event processing do not permanently lose domain events.

#### Acceptance Criteria

1. THE Worker SHALL configure BullMQ jobs with a maximum attempt count equal to `WORKER_MAX_ATTEMPTS` (default 3) so that failed jobs are automatically retried by BullMQ.
2. WHEN a BullMQ job fails and has remaining retry attempts, THE Worker SHALL allow BullMQ to re-enqueue the job automatically with its built-in backoff strategy.
3. WHEN a BullMQ job has exceeded its maximum retry attempts, THE Worker SHALL log the failure including the job ID, event type, and error message, and not re-enqueue it.
4. THE Worker SHALL check the `processed_events` table before processing a job; if the `eventId` already exists, THE Worker SHALL skip the job as a duplicate without error.
5. WHEN a job is processed successfully, THE Worker SHALL insert the `eventId` into the `processed_events` table within the same transaction to prevent double-processing.
6. WHEN Redis is restarted, unprocessed jobs persisted in Redis SHALL be picked up automatically by BullMQ upon reconnection, requiring no manual intervention.

---

### Requirement 9: Health Check Endpoint

**User Story:** As a platform operator, I want a dedicated liveness endpoint, so that container orchestration systems (e.g., Docker, Kubernetes) can determine whether the process is alive and needs to be restarted.

#### Acceptance Criteria

1. THE System SHALL expose `GET /health` that returns HTTP 200 while the process is alive.
2. WHEN `GET /health` is called, THE System SHALL return a JSON body containing `status: "ok"`, the service name, version, and process uptime in seconds.
3. THE Health_Check SHALL return HTTP 200 regardless of the state of PostgreSQL or Redis — it reflects process liveness only.
4. THE Health_Check SHALL NOT be subject to rate limiting.
5. THE Health_Check SHALL NOT require an authentication token.

---

### Requirement 10: Readiness Check Endpoint

**User Story:** As a platform operator, I want a dedicated readiness endpoint that actively probes dependencies, so that load balancers can stop sending traffic to instances that cannot safely serve requests.

#### Acceptance Criteria

1. THE System SHALL expose `GET /ready` that actively checks PostgreSQL connectivity by executing `SELECT 1` within `DATABASE_CONNECTION_TIMEOUT` milliseconds.
2. THE System SHALL expose `GET /ready` that actively checks Redis connectivity by issuing a `PING` command within `REDIS_CONNECTION_TIMEOUT` milliseconds.
3. WHEN all dependencies are healthy, THE Readiness_Check SHALL return HTTP 200 with `status: "ready"`.
4. WHEN PostgreSQL is unavailable, THE Readiness_Check SHALL return HTTP 503 with `status: "not_ready"`.
5. WHEN only Redis is unavailable, THE Readiness_Check SHALL return HTTP 200 with `status: "degraded"`, because the API can continue serving requests via the Outbox Pattern.
6. THE Readiness_Check SHALL include per-dependency status and measured latency in milliseconds in the response body.
7. THE Readiness_Check SHALL NOT be subject to rate limiting.
8. THE Readiness_Check SHALL NOT require an authentication token.

---

### Requirement 11: Request ID Middleware

**User Story:** As a platform operator, I want every HTTP request to carry a unique request identifier, so that I can correlate client-reported errors with server-side log entries.

#### Acceptance Criteria

1. THE Request_ID_Middleware SHALL inspect the incoming `X-Request-Id` header on every request.
2. WHEN the `X-Request-Id` header is present and non-empty, THE Request_ID_Middleware SHALL use it as the request identifier without modification.
3. WHEN the `X-Request-Id` header is absent or empty, THE Request_ID_Middleware SHALL generate a new UUID v4 as the request identifier.
4. THE Request_ID_Middleware SHALL attach the request identifier to `req.requestId` for use by downstream handlers and error handlers.
5. THE Request_ID_Middleware SHALL echo the request identifier in the `X-Request-Id` response header on every response.
6. THE Error_Handler SHALL include `requestId` in every error response body to aid client-side error correlation.

---

### Requirement 12: Centralized Error Handling with Standardised Error Codes

**User Story:** As an API consumer, I want all error responses to use a consistent, machine-readable format, so that my client can programmatically handle different error categories without parsing human-readable messages.

#### Acceptance Criteria

1. THE Error_Handler SHALL return every error response as a JSON object containing `success: false`, `message`, `errorCode`, and `requestId`.
2. THE Error_Handler SHALL map HTTP status codes to the following `errorCode` values: 400 → `VALIDATION_ERROR`, 401 → `AUTHENTICATION_ERROR`, 403 → `AUTHORIZATION_ERROR`, 404 → `NOT_FOUND`, 409 → `CONFLICT`, 429 → `RATE_LIMITED`, 503 → `DEPENDENCY_UNAVAILABLE`, 504 → `DEPENDENCY_TIMEOUT`, 500 → `INTERNAL_ERROR`.
3. WHEN a `DependencyTimeoutError` is thrown, THE Error_Handler SHALL return HTTP 504 with `errorCode: "DEPENDENCY_TIMEOUT"`.
4. WHEN a `CircuitOpenError` is thrown, THE Error_Handler SHALL return HTTP 503 with `errorCode: "DEPENDENCY_UNAVAILABLE"`.
5. WHEN `NODE_ENV` is not `production`, THE Error_Handler SHALL include a `detail` field in 500-level responses containing the raw error message to aid debugging.
6. WHEN `NODE_ENV` is `production`, THE Error_Handler SHALL omit stack traces and raw error details from all responses.
7. THE Error_Handler SHALL be registered as the last middleware in `src/app.ts`, after all routes and the 404 handler.

---

### Requirement 13: Graceful Shutdown

**User Story:** As a platform operator, I want the server to drain in-flight requests before exiting on `SIGINT` or `SIGTERM`, so that no requests are abruptly terminated during deployment restarts.

#### Acceptance Criteria

1. WHEN the process receives `SIGINT` or `SIGTERM`, THE System SHALL call `server.close()` to stop accepting new HTTP connections while finishing in-flight requests.
2. AFTER the HTTP server reports closed, THE System SHALL close the BullMQ queue connection.
3. AFTER the queue connection is closed, THE System SHALL call `prisma.$disconnect()` to release the database connection pool.
4. AFTER all connections are closed, THE System SHALL exit with code 0.
5. THE System SHALL configure a configurable force-exit timer via `SHUTDOWN_TIMEOUT_MS` (default 10000 ms); if graceful shutdown takes longer than this value, THE System SHALL exit with code 1.
6. THE force-exit timer SHALL be unreffed so it does not prevent the Node.js event loop from completing naturally before the timeout expires.
7. THE System SHALL log each shutdown step (signal received, HTTP closed, queue closed, Prisma disconnected, shutdown complete) to standard output.

---

### Requirement 14: Rate Limiting

**User Story:** As a platform operator, I want per-IP request rate limiting on all API endpoints, so that a single misbehaving client cannot overwhelm the platform during an emergency.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL apply to all routes under `/api/` using `RATE_LIMIT_MAX_REQUESTS` requests per `RATE_LIMIT_WINDOW_MS` milliseconds per IP address (defaults: 100 requests / 60000 ms).
2. THE Auth_Rate_Limiter SHALL apply to `/api/auth/` routes at 20% of the general limit (default: 20 requests per window) to prevent brute-force attacks.
3. THE Expensive_Rate_Limiter SHALL apply to computationally intensive routes (re-optimization) at 50% of the general limit (default: 50 requests per window).
4. WHEN a client exceeds the rate limit, THE Rate_Limiter SHALL return HTTP 429 with `errorCode: "RATE_LIMITED"` and `requestId`.
5. THE Rate_Limiter SHALL include `RateLimit-*` standard headers in all responses under `/api/` indicating the limit, remaining requests, and reset time.
6. THE Rate_Limiter SHALL NOT apply to `GET /health` or `GET /ready`.
7. WHEN `X-Forwarded-For` is present, THE Rate_Limiter SHALL use the first IP in the header as the client identifier; otherwise THE Rate_Limiter SHALL use `req.ip`.

---

### Requirement 15: Secure CORS Configuration

**User Story:** As a platform operator, I want CORS to be restricted to explicitly approved origins in production, so that browser-based cross-origin requests from unknown domains are rejected.

#### Acceptance Criteria

1. THE System SHALL configure CORS allowed origins via the `CORS_ORIGINS` environment variable, which accepts a comma-separated list of origin URLs.
2. WHEN `CORS_ORIGINS` is not set, the value defaults to `*`, which is acceptable for local development only.
3. THE CORS configuration SHALL allow the following methods: `GET`, `POST`, `PATCH`, `PUT`, `DELETE`, `OPTIONS`.
4. THE CORS configuration SHALL allow the following request headers: `Content-Type`, `Authorization`, `X-Request-Id`, `Idempotency-Key`.
5. THE CORS configuration SHALL enable credentials (`credentials: true`) to support cookie-based sessions.
6. WHERE `CORS_ORIGINS` is a specific list of origins, THE System SHALL reject preflight and cross-origin requests from origins not in the list with HTTP 403.

---

### Requirement 16: Security Headers via Helmet

**User Story:** As a platform operator, I want standard security headers applied to all responses, so that browsers are instructed to apply baseline protections against common web vulnerabilities.

#### Acceptance Criteria

1. THE System SHALL apply `helmet()` as the first middleware in `src/app.ts` so that security headers are present on every response, including error responses and 404 responses.
2. THE Helmet_Middleware SHALL set `X-Content-Type-Options: nosniff` on all responses.
3. THE Helmet_Middleware SHALL set `X-Frame-Options: SAMEORIGIN` or `DENY` on all responses.
4. THE Helmet_Middleware SHALL set `X-XSS-Protection: 0` (disabling the legacy browser XSS filter, as recommended by modern security guidance).
5. THE Helmet_Middleware SHALL set `Strict-Transport-Security` on all responses to enforce HTTPS in supporting browsers.

---

### Requirement 17: Request Size Limits

**User Story:** As a platform operator, I want incoming request bodies to have a maximum size limit, so that a client cannot send an oversized payload that exhausts server memory.

#### Acceptance Criteria

1. THE System SHALL reject JSON request bodies larger than 1 MB with HTTP 413.
2. THE System SHALL configure the body size limit via `express.json({ limit: '1mb' })` applied globally in `src/app.ts`.
3. WHEN a request body exceeds the size limit, THE System SHALL return an error response before the request reaches any route handler.

---

### Requirement 18: Configuration Validation at Startup

**User Story:** As a platform operator, I want the server to refuse to start when required configuration is missing or invalid, so that misconfigured deployments fail immediately rather than silently misbehaving at runtime.

#### Acceptance Criteria

1. THE Config_Validator SHALL verify that `JWT_SECRET` is set; IF absent, THEN THE System SHALL throw a configuration error and exit before listening on any port.
2. THE Config_Validator SHALL verify that `DATABASE_URL` is set; IF absent, THEN THE System SHALL throw a configuration error and exit.
3. WHEN `RETRY_INITIAL_DELAY` is zero or negative, THE Config_Validator SHALL throw a configuration error.
4. WHEN `RETRY_MAX_DELAY` is less than `RETRY_INITIAL_DELAY`, THE Config_Validator SHALL throw a configuration error.
5. WHEN `CIRCUIT_BREAKER_FAILURE_THRESHOLD` is less than 1, THE Config_Validator SHALL throw a configuration error.
6. THE Config_Validator SHALL be invoked as the first action in `src/index.ts` before any module that reads configuration is imported.
7. THE Config_Validator SHALL collect all configuration errors into a single message rather than stopping at the first error.
