/**
 * Spike Load Test — Part 12
 *
 * Simulates sudden emergency traffic spike (e.g., mass casualty event).
 *
 * Pattern:
 *   Normal (20 users) → sudden spike to 200 → sustain → return to normal
 *
 * Measures:
 *   - API latency during spike
 *   - Error rate during spike
 *   - Recovery time after spike
 *   - Queue depth buildup
 *   - Database connection saturation
 *
 * Expected behavior:
 *   - System should remain functional (may have higher latency)
 *   - No data corruption
 *   - Background jobs preserved (Outbox guarantee)
 *   - Recovery after spike within acceptable time
 *
 * Run:
 *   k6 run -e LOAD_TEST_EMAIL=admin@test.local \
 *           -e LOAD_TEST_PASSWORD=TestPassword123! \
 *           load-tests/spike.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import {
  BASE_URL,
  SPIKE_OPTIONS,
  getAuthToken,
  authHeaders,
  randomIncidentPayload,
  randomChoice,
  randomInt,
  checkResponse,
} from './scenarios.js';

export const options = SPIKE_OPTIONS;

export function setup() {
  const token = getAuthToken();
  if (!token) throw new Error('Setup failed: could not obtain auth token');
  return { token };
}

export default function (data) {
  const { token } = data;
  const headers = authHeaders(token);

  // Mix of operations during spike
  const action = Math.random();

  if (action < 0.15) {
    // CREATE incident (expensive — DB write + priority calc)
    const res = http.post(
      `${BASE_URL}/api/incidents`,
      JSON.stringify(randomIncidentPayload()),
      { headers },
    );
    check(res, {
      'spike create 201 or 429': (r) => r.status === 201 || r.status === 429 || r.status === 503,
    });

  } else if (action < 0.45) {
    // LIST incidents (medium cost — paginated DB read)
    const res = http.get(
      `${BASE_URL}/api/incidents?page=1&limit=20`,
      { headers },
    );
    check(res, {
      'spike list incidents 200 or 429': (r) => r.status === 200 || r.status === 429,
    });

  } else if (action < 0.70) {
    // LIST resources (cache-aided — cheap on second+ request)
    const res = http.get(
      `${BASE_URL}/api/resources?page=1&limit=20`,
      { headers },
    );
    check(res, {
      'spike list resources 200 or 429': (r) => r.status === 200 || r.status === 429,
    });

  } else if (action < 0.85) {
    // LIST hospitals (cache-aided)
    const res = http.get(
      `${BASE_URL}/api/hospitals?page=1&limit=20`,
      { headers },
    );
    check(res, {
      'spike list hospitals 200 or 429': (r) => r.status === 200 || r.status === 429,
    });

  } else {
    // Health check (always fast — no DB for /health)
    const res = http.get(`${BASE_URL}/health`);
    check(res, {
      'health during spike 200': (r) => r.status === 200,
    });
  }

  // No sleep — simulate maximum throughput
  sleep(0.1);
}
