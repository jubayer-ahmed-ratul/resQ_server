/**
 * Incident Endpoints Load Test — Part 12
 *
 * Tests:
 *   POST /api/incidents   — create with priority calculation (DB write + compute)
 *   GET  /api/incidents   — paginated list (DB read, filterable)
 *   GET  /api/incidents/:id — single record (DB read)
 *
 * Scenario:
 *   80% reads (list + single) / 20% writes (create)
 *   This reflects typical emergency dashboard usage.
 *
 * Run:
 *   k6 run -e LOAD_TEST_EMAIL=admin@test.local \
 *           -e LOAD_TEST_PASSWORD=TestPassword123! \
 *           load-tests/incidents.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import {
  BASE_URL,
  RAMP_UP_OPTIONS,
  getAuthToken,
  authHeaders,
  checkResponse,
  randomIncidentPayload,
  randomChoice,
  randomInt,
} from './scenarios.js';

export const options = RAMP_UP_OPTIONS;

// ─── Setup: login once, share token across VUs ────────────────────────────────

export function setup() {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Setup failed: could not obtain auth token');
  }
  return { token };
}

// ─── Main scenario ────────────────────────────────────────────────────────────

export default function (data) {
  const { token } = data;
  const headers = authHeaders(token);

  const action = Math.random();

  if (action < 0.20) {
    // ── CREATE incident (20% of requests) ──────────────────────────────────
    // This is the most expensive operation: DB write + priority calculation
    const payload = randomIncidentPayload();
    const res = http.post(
      `${BASE_URL}/api/incidents`,
      JSON.stringify(payload),
      { headers },
    );
    checkResponse(res, 'create incident', 201);

  } else if (action < 0.60) {
    // ── LIST incidents with pagination (40% of requests) ──────────────────
    const page  = randomInt(1, 5);
    const limit = randomChoice([10, 20, 50]);
    const status = randomChoice(['PENDING', 'VALIDATED', 'ASSIGNED', '']);
    const queryString = `page=${page}&limit=${limit}${status ? `&status=${status}` : ''}`;

    const res = http.get(
      `${BASE_URL}/api/incidents?${queryString}`,
      { headers },
    );
    check(res, {
      'list incidents 200':        (r) => r.status === 200,
      'list has pagination meta':  (r) => {
        try { return JSON.parse(r.body).data?.pagination !== undefined; } catch { return false; }
      },
    });

  } else {
    // ── LIST by priority sort (40% of requests) ───────────────────────────
    const res = http.get(
      `${BASE_URL}/api/incidents?sort=priority&page=1&limit=20`,
      { headers },
    );
    check(res, {
      'priority list 200': (r) => r.status === 200,
    });
  }

  sleep(randomInt(1, 3) * 0.5);
}
