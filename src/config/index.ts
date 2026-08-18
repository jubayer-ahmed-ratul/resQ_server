import dotenv from 'dotenv';

dotenv.config();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function int(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(`[Config] "${key}" must be an integer (got "${raw}").`);
  }
  return parsed;
}

function parseOrigins(raw: string | undefined): string | string[] {
  if (!raw || raw === '*') return '*';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// ─── Config object ────────────────────────────────────────────────────────────

const config = {
  port:      int('PORT', 5000),
  nodeEnv:   process.env['NODE_ENV'] ?? 'development',
  databaseUrl: process.env['DATABASE_URL'] ?? '',

  jwt: {
    secret:    process.env['JWT_SECRET'] ?? '',
    expiresIn: process.env['JWT_EXPIRES_IN'] ?? '7d',
  },

  resourceAverageSpeedKmh: int('RESOURCE_AVERAGE_SPEED_KMH', 60),

  // ─── Redis / Queue ──────────────────────────────────────────────────────────
  redis: {
    host:     process.env['REDIS_HOST'] ?? '127.0.0.1',
    port:     int('REDIS_PORT', 6379),
    password: process.env['REDIS_PASSWORD'] ?? undefined,
    connectTimeout: int('REDIS_CONNECTION_TIMEOUT', 5000),
  },

  worker: {
    maxAttempts:       int('WORKER_MAX_ATTEMPTS', 3),
    outboxPollIntervalMs: int('OUTBOX_POLL_INTERVAL_MS', 5000),
  },

  // ─── HTTP ────────────────────────────────────────────────────────────────────
  http: {
    requestTimeout: int('HTTP_REQUEST_TIMEOUT', 30000),
  },

  // ─── Database ────────────────────────────────────────────────────────────────
  database: {
    connectionTimeout: int('DATABASE_CONNECTION_TIMEOUT', 10000),
  },

  // ─── Retry ───────────────────────────────────────────────────────────────────
  retry: {
    maxAttempts:  int('RETRY_MAX_ATTEMPTS', 3),
    initialDelay: int('RETRY_INITIAL_DELAY', 100),
    maxDelay:     int('RETRY_MAX_DELAY', 5000),
  },

  // ─── Circuit breaker ─────────────────────────────────────────────────────────
  circuitBreaker: {
    failureThreshold: int('CIRCUIT_BREAKER_FAILURE_THRESHOLD', 5),
    resetTimeout:     int('CIRCUIT_BREAKER_RESET_TIMEOUT', 30000),
  },

  // ─── Graceful shutdown ───────────────────────────────────────────────────────
  shutdownTimeoutMs: int('SHUTDOWN_TIMEOUT_MS', 10000),

  // ─── Idempotency ─────────────────────────────────────────────────────────────
  idempotencyTtlSeconds: int('IDEMPOTENCY_TTL_SECONDS', 86400),

  // ─── Rate limiting ───────────────────────────────────────────────────────────
  rateLimit: {
    windowMs:    int('RATE_LIMIT_WINDOW_MS', 60000),
    maxRequests: int('RATE_LIMIT_MAX_REQUESTS', 100),
  },

  // ─── CORS ────────────────────────────────────────────────────────────────────
  corsOrigins: parseOrigins(process.env['CORS_ORIGINS']),

  // ─── Cleanup scheduler ───────────────────────────────────────────────────────
  /** How often (ms) the cleanup job runs. Default: 6 hours. */
  cleanupIntervalMs: int('CLEANUP_INTERVAL_MS', 6 * 60 * 60 * 1000),
  /** How many days to retain ProcessedEvent rows. Default: 7 days. */
  processedEventRetentionDays: int('PROCESSED_EVENT_RETENTION_DAYS', 7),

  // ─── Cache (Part 12) ─────────────────────────────────────────────────────────
  /** Default TTL for cached values in seconds. Default: 60 seconds. */
  cache: {
    defaultTtlSeconds: int('CACHE_DEFAULT_TTL_SECONDS', 60),
  },

  // ─── Worker concurrency (Part 12) ────────────────────────────────────────────
  /** Number of BullMQ jobs to process in parallel per worker instance. */
  workerConcurrency: int('WORKER_CONCURRENCY', 5),

  // ─── Pagination (Part 12) ────────────────────────────────────────────────────
  /** Maximum allowed page size for list endpoints. */
  pagination: {
    defaultLimit: int('PAGINATION_DEFAULT_LIMIT', 20),
    maxLimit: int('PAGINATION_MAX_LIMIT', 100),
  },
};

export default config;

// ─── Startup validation ───────────────────────────────────────────────────────
// Called once from index.ts / worker.ts before accepting any traffic.

export function validateConfig(): void {
  const errors: string[] = [];

  if (!config.jwt.secret) {
    errors.push('JWT_SECRET is required.');
  }
  if (!config.databaseUrl) {
    errors.push('DATABASE_URL is required.');
  }
  if (config.retry.initialDelay <= 0) {
    errors.push('RETRY_INITIAL_DELAY must be > 0.');
  }
  if (config.retry.maxDelay < config.retry.initialDelay) {
    errors.push('RETRY_MAX_DELAY must be >= RETRY_INITIAL_DELAY.');
  }
  if (config.circuitBreaker.failureThreshold < 1) {
    errors.push('CIRCUIT_BREAKER_FAILURE_THRESHOLD must be >= 1.');
  }

  if (errors.length > 0) {
    throw new Error(`[Config] Configuration errors:\n  ${errors.join('\n  ')}`);
  }
}
