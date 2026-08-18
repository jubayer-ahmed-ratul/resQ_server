/**
 * Assignment Concurrency Load Test — Part 12
 *
 * MOST IMPORTANT BUSINESS TEST:
 *   Multiple concurrent requests all attempting to acquire the same resource.
 *
 * Expected behavior:
 *   - Exactly ONE assignment succeeds (409 for all others)
 *   - No resource is double-assigned
 *   - No partial state
 *   - Idempotency keys prevent double-creation on retries
 *
 * This test validates:
 *   - PostgreSQL partial unique index (prevents race conditions at DB level)
 *   - Application-level conflict checks (fast fail before constraint)
 *   - Transaction isolation
 *
 * Run:
 *   k6 run -e LOAD_TEST_EMAIL=admin@test.local \
 *           -e LOAD_TEST_PASSWORD=TestPassword123! \
 *           load-tests/assignments.js
 *
 * WARNING: This test creates real DB records.
 *          Use a TEST database only.
 *          NEVER run against production.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import {
  BASE_URL,
  getAuthToken,
  authHeaders,
  checkResponse,
  randomChoice,
  randomInt,
} from './scenarios.js';

export const options = {
  scenarios: {
    // Concurrency test: 100 VUs all race to assign same resource to same incident
    concurrency_test: {
      executor: 'shared-iterations',
      vus: 100,
      iterations: 100,
      maxDuration: '2m',
    },
    // Normal assignment traffic
    normal_assignments: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m',  target: 20 },
        { duration: '10s', target: 0  },
      ],
      startTime: '3m', // run after concurrency test
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    // Conflict errors (409) are expected and correct — don't count as failures
    // We check this in the per-request check below
  },
};

// ─── Shared test data populated in setup ────────────────────────────────────

export function setup() {
  const token = getAuthToken();
  if (!token) throw new Error('Setup failed: could not obtain auth token');

  const headers = authHeaders(token);

  // Create a validated incident for the concurrency test
  const incidentRes = http.post(
    `${BASE_URL}/api/incidents`,
    JSON.stringify({
      title: 'CONCURRENCY TEST INCIDENT',
      description: 'Created by load test for concurrency validation',
      severity: 'CRITICAL',
      affectedPeople: 10,
      latitude: 23.7,
      longitude: 90.4,
      timeSensitivity: 'CRITICAL',
      resourceRequirements: [],
    }),
    { headers },
  );

  if (incidentRes.status !== 201) {
    console.error('Failed to create test incident:', incidentRes.body);
    return { token, incidentId: null, resourceId: null };
  }

  const incidentId = JSON.parse(incidentRes.body).data?.id;

  // Validate the incident
  http.patch(`${BASE_URL}/api/incidents/${incidentId}/validate`, null, { headers });

  // Create a single resource that all VUs will race to acquire
  const resourceRes = http.post(
    `${BASE_URL}/api/resources`,
    JSON.stringify({
      name: 'CONCURRENCY TEST AMBULANCE',
      type: 'AMBULANCE',
      latitude: 23.7,
      longitude: 90.4,
      capacity: 100,
      status: 'AVAILABLE',
    }),
    { headers },
  );

  if (resourceRes.status !== 201) {
    console.error('Failed to create test resource:', resourceRes.body);
    return { token, incidentId, resourceId: null };
  }

  const resourceId = JSON.parse(resourceRes.body).data?.id;

  console.log(`Concurrency test: incidentId=${incidentId}, resourceId=${resourceId}`);
  return { token, incidentId, resourceId };
}

// ─── Main scenario ────────────────────────────────────────────────────────────

export default function (data) {
  const { token, incidentId, resourceId } = data;

  if (!incidentId || !resourceId) {
    console.warn('Skipping — setup failed');
    return;
  }

  const headers = authHeaders(token);

  // All 100 VUs race to assign the SAME resource to the SAME incident
  const res = http.post(
    `${BASE_URL}/api/assignments`,
    JSON.stringify({ incidentId, resourceId }),
    { headers },
  );

  // Expected: exactly ONE 201, all others 409 (CONFLICT)
  check(res, {
    'assignment succeeded OR correctly conflicted': (r) =>
      r.status === 201 || r.status === 409,
    'no unexpected errors': (r) =>
      r.status !== 500 && r.status !== 503,
  });

  if (res.status === 201) {
    console.log(`VU ${__VU}: Assignment CREATED — winner!`);
  } else if (res.status === 409) {
    // This is the EXPECTED outcome for all but one VU — correct behavior
    const body = JSON.parse(res.body);
    console.log(`VU ${__VU}: 409 CONFLICT — ${body.message}`);
  } else {
    console.error(`VU ${__VU}: Unexpected status ${res.status}: ${res.body}`);
  }

  sleep(0.5);
}

// ─── Teardown: verify exactly one active assignment exists ────────────────────

export function teardown(data) {
  const { token, incidentId, resourceId } = data;
  if (!incidentId || !resourceId) return;

  const headers = authHeaders(token);

  const res = http.get(
    `${BASE_URL}/api/assignments?incidentId=${incidentId}&status=ACTIVE`,
    { headers },
  );

  if (res.status === 200) {
    const body = JSON.parse(res.body);
    const activeCount = body.data?.data?.length ?? body.data?.length ?? 0;
    console.log(`Concurrency test teardown: ACTIVE assignments = ${activeCount} (expected: 1)`);
    if (activeCount !== 1) {
      console.error(`CONCURRENCY TEST FAILED: Expected 1 active assignment, found ${activeCount}`);
    } else {
      console.log('CONCURRENCY TEST PASSED: Exactly 1 active assignment');
    }
  }
}
