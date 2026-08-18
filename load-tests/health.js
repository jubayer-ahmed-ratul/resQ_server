/**
 * Health Endpoint Load Test — Part 12
 *
 * Tests: GET /health (liveness) and GET /ready (readiness)
 *
 * Purpose:
 *   - Verify health endpoints remain fast under load
 *   - Load balancers call /health or /ready frequently
 *   - These must NOT become bottlenecks
 *
 * Run:
 *   k6 run load-tests/health.js
 *   k6 run -e BASE_URL=http://localhost:5001 load-tests/health.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, RAMP_UP_OPTIONS, checkResponse } from './scenarios.js';

export const options = {
  ...RAMP_UP_OPTIONS,
  thresholds: {
    // Health endpoints should be very fast — they don't hit DB for /health
    http_req_duration: ['p(95)<100', 'p(99)<300'],
    http_req_failed:   ['rate<0.01'],
  },
};

export default function () {
  // ─── Liveness ─────────────────────────────────────────────────────────────
  const liveness = http.get(`${BASE_URL}/health`);
  check(liveness, {
    'health status 200': (r) => r.status === 200,
    'health status ok':  (r) => {
      try { return JSON.parse(r.body).status === 'ok'; } catch { return false; }
    },
  });

  sleep(0.5);

  // ─── Readiness ────────────────────────────────────────────────────────────
  // /ready hits DB + Redis, so it's slower but still must be acceptable
  const readiness = http.get(`${BASE_URL}/ready`);
  check(readiness, {
    'ready status 200 or 503': (r) => r.status === 200 || r.status === 503,
    'ready has status field':  (r) => {
      try { return 'status' in JSON.parse(r.body); } catch { return false; }
    },
  });

  sleep(1);
}
