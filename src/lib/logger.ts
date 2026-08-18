/**
 * Structured Logger — Part 11
 *
 * Lightweight JSON logger built on top of console.* — no external dependency
 * needed since pino/winston aren't installed and we avoid introducing new deps.
 *
 * In production (NODE_ENV=production) every line is a single JSON object,
 * making it easy to ingest into CloudWatch, Datadog, or any log aggregator.
 *
 * In development the output is human-readable (formatted JSON).
 *
 * Fields included automatically:
 *   timestamp  — ISO 8601
 *   level      — info | warn | error | debug
 *   service    — 'emergency-response-api'
 *
 * Caller-supplied context fields (requestId, eventId, operation, etc.) are
 * merged into the log line as top-level fields — never nested.
 *
 * NEVER log:
 *   - passwords, JWTs, API keys
 *   - DATABASE_URL, REDIS_PASSWORD
 *   - stack traces in production responses
 */

const SERVICE_NAME = 'emergency-response-api';
const IS_PROD = process.env['NODE_ENV'] === 'production';

// ─── Log levels ────────────────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// ─── Context fields ────────────────────────────────────────────────────────────

export interface LogContext {
  requestId?: string;
  eventId?: string;
  jobId?: string;
  operation?: string;
  status?: string | number;
  durationMs?: number;
  errorCode?: string;
  eventType?: string;
  attempt?: number;
  [key: string]: unknown; // allow arbitrary extra fields
}

// ─── Core writer ──────────────────────────────────────────────────────────────

function write(level: LogLevel, message: string, context: LogContext = {}): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    message,
    ...context,
  };

  const output = IS_PROD ? JSON.stringify(entry) : JSON.stringify(entry, null, 2);

  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

const logger = {
  debug: (message: string, context?: LogContext) => write('debug', message, context),
  info:  (message: string, context?: LogContext) => write('info',  message, context),
  warn:  (message: string, context?: LogContext) => write('warn',  message, context),
  error: (message: string, context?: LogContext) => write('error', message, context),
};

export default logger;
