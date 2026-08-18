/**
 * k6 Shared Scenarios & Helpers — Part 12
 *
 * Contains:
 *   - Common options (thresholds, stages)
 *   - Shared auth helper (login once, reuse token)
 *   - Environment config from LOAD_TEST_BASE_URL
 *   - Utility functions
 *
 * k6 installation:
 *   https://k6.io/docs/get-started/installation/
 *   Windows: winget install k6 --source winget
 *   Or download from: https://github.com/grafana/k6/releases
 *
 * Run all tests:
 *   k6 run load-tests/health.js
 *   k6 run load-tests/incidents.js
 *   k6 run load-tests/assignments.js
 *   k6 run load-tests/spike.js
 *   k6 run load-tests/soak.js
 *
 * Required env vars (set in .env or shell):
 *   LOAD_TEST_BASE_URL=http://localhost:5000
 *   LOAD_TEST_EMAIL=admin@example.com
 *   LOAD_TEST_PASSWORD=yourpassword
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ─── Base URL ─────────────────────────────────────────────────────────────────
// Override via: k6 run -e BASE_URL=http://localhost:5001 load-tests/health.js

export const BASE_URL = __ENV.BASE_URL || __ENV.LOAD_TEST_BASE_URL || 'http://localhost:5000';

// ─── Default auth credentials ─────────────────────────────────────────────────
// NEVER hard-code real credentials — use environment variables only.

export const AUTH_EMAIL    = __ENV.LOAD_TEST_EMAIL    || 'admin@test.local';
export const AUTH_PASSWORD = __ENV.LOAD_TEST_PASSWORD || 'TestPassword123!';

// ─── Custom metrics ───────────────────────────────────────────────────────────

export const errorRate   = new Rate('errors');
export const cacheHitRate = new Rate('cache_hits');
export const dbQueryTime  = new Trend('db_query_time_ms');

// ─── Common performance thresholds ────────────────────────────────────────────
// These represent TARGETS, not guarantees.
// Actual values depend on hardware, database size, and concurrent load.

export const THRESHOLDS = {
  // HTTP request duration
  http_req_duration: [
    'p(50)<200',  // 50th percentile under 200ms
    'p(95)<800',  // 95th percentile under 800ms
    'p(99)<2000', // 99th percentile under 2s
  ],
  // Error rate
  http_req_failed: ['rate<0.05'], // less than 5% errors
  // Custom error rate
  errors: ['rate<0.05'],
};

// ─── Auth helper ──────────────────────────────────────────────────────────────

/**
 * getAuthToken
 *
 * Logs in and returns a JWT token.
 * Call once in setup() — do not call per-VU to avoid hammering auth.
 */
export function getAuthToken() {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: AUTH_EMAIL, password: AUTH_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  const ok = check(res, {
    'login status 200': (r) => r.status === 200,
    'login has token':  (r) => {
      try {
        return JSON.parse(r.body).data?.token !== undefined;
      } catch {
        return false;
      }
    },
  });

  if (!ok) {
    console.error(`Login failed: ${res.status} — ${res.body}`);
    return null;
  }

  return JSON.parse(res.body).data.token;
}

// ─── Auth headers helper ──────────────────────────────────────────────────────

export function authHeaders(token) {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

// ─── Baseline options (single-stage steady load) ──────────────────────────────

export const BASELINE_OPTIONS = {
  vus: 10,
  duration: '30s',
  thresholds: THRESHOLDS,
};

// ─── Ramp-up options ─────────────────────────────────────────────────────────

export const RAMP_UP_OPTIONS = {
  stages: [
    { duration: '30s', target: 10  },
    { duration: '30s', target: 25  },
    { duration: '30s', target: 50  },
    { duration: '30s', target: 100 },
    { duration: '30s', target: 150 },
    { duration: '30s', target: 50  }, // cooldown
    { duration: '30s', target: 0   },
  ],
  thresholds: THRESHOLDS,
};

// ─── Spike options ────────────────────────────────────────────────────────────

export const SPIKE_OPTIONS = {
  stages: [
    { duration: '30s', target: 20  }, // normal baseline
    { duration: '10s', target: 200 }, // sudden spike
    { duration: '60s', target: 200 }, // sustained spike
    { duration: '10s', target: 20  }, // return to normal
    { duration: '30s', target: 20  }, // verify recovery
    { duration: '10s', target: 0   },
  ],
  thresholds: {
    http_req_duration: [
      'p(95)<3000', // more lenient during spike
    ],
    http_req_failed: ['rate<0.10'], // up to 10% errors during spike
    errors: ['rate<0.10'],
  },
};

// ─── Soak options (sustained load for leak detection) ────────────────────────

export const SOAK_OPTIONS = {
  stages: [
    { duration: '2m',  target: 20 }, // warm up
    { duration: '30m', target: 20 }, // sustained — watch memory/connections
    { duration: '2m',  target: 0  }, // cool down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed:   ['rate<0.05'],
  },
};

// ─── Utilities ────────────────────────────────────────────────────────────────

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomFloat(min, max, decimals = 4) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

export function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function checkResponse(res, name, expectedStatus = 200) {
  const ok = check(res, {
    [`${name} status ${expectedStatus}`]: (r) => r.status === expectedStatus,
    [`${name} has body`]:                 (r) => r.body && r.body.length > 0,
  });
  errorRate.add(!ok);
  return ok;
}

// ─── Test data generators ─────────────────────────────────────────────────────

const SEVERITIES       = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const TIME_SENSIT      = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const RESOURCE_TYPES   = ['AMBULANCE', 'RESCUE_TEAM', 'HELICOPTER', 'OTHER'];
const RESOURCE_STATUSES = ['AVAILABLE', 'BUSY', 'UNAVAILABLE'];
const HOSPITAL_STATUSES = ['OPERATIONAL', 'LIMITED'];

export function randomIncidentPayload() {
  return {
    title:          `Load Test Incident ${Date.now()}`,
    description:    'Automated load test incident — do not process in production.',
    severity:       randomChoice(SEVERITIES),
    affectedPeople: randomInt(1, 200),
    latitude:       randomFloat(-90, 90),
    longitude:      randomFloat(-180, 180),
    timeSensitivity: randomChoice(TIME_SENSIT),
    environmentalCondition: randomChoice(['NORMAL', 'FLOOD', 'FIRE', null]),
    resourceRequirements:  [],
  };
}

export function randomResourcePayload() {
  return {
    name:     `Test Resource ${Date.now()}`,
    type:     randomChoice(RESOURCE_TYPES),
    latitude: randomFloat(-90, 90),
    longitude: randomFloat(-180, 180),
    capacity: randomInt(1, 10),
    status:   'AVAILABLE',
  };
}

export function randomHospitalPayload() {
  const bedCap = randomInt(50, 500);
  const icuCap = randomInt(10, 100);
  return {
    name:             `Test Hospital ${Date.now()}`,
    latitude:         randomFloat(-90, 90),
    longitude:        randomFloat(-180, 180),
    bedCapacity:      bedCap,
    availableBeds:    randomInt(0, bedCap),
    icuCapacity:      icuCap,
    availableICUBeds: randomInt(0, icuCap),
    status:           randomChoice(HOSPITAL_STATUSES),
  };
}
