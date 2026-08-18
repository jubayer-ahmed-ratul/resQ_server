/**
 * Soak Load Test — Part 12
 *
 * Runs sustained, moderate traffic for an extended period.
 *
 * Purpose:
 *   Detect slow-growing problems that don't appear in short tests:
 *   - Memory leaks (process RSS grows over time)
 *   - Connection leaks (DB connections not released)
 *   - Cache key growth (unbounded Redis memory)
 *   - Queue depth accumulation (workers falling behind)
 *   - Increasing latency (degradation under sustained load)
 *
 * What to monitor during this test:
 *   API:      process memory (RSS), CPU%, req/sec, p95 latency
 *   DB:       pg_stat_activity (active connections), slow query log
 *   Redis:    INFO memory (used_memory), INFO keyspace (key count)
 *   Workers:  completed/failed job counts, processing time
 *
 * Run (default 30 minutes — adjust SOAK_DURATION_MINUTES for longer):
 *   k6 run -e LOAD_TEST_EMAIL=admin@test.local \
 *           -e LOAD_TEST_PASSWORD=TestPassword123! \
 *           load-tests/soak.js
 *
 * Run with custom duration:
 *   k6 run -e SOAK_DURATION=60m load-tests/soak.js
 *
 * WARNING: Use TEST database only. Long-running test accumulates data.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import {
  BASE_URL,
  SOAK_OPTIONS,
  getAuthToken,
  authHeaders,
  randomIncidentPayload,
  randomInt,
} from './scenarios.js';

// Allow override via env var
const soakDuration = __ENV.SOAK_DURATION || '30m';

export const options = {
  stages: [
    { duration: '2m',           target: 20 }, // warm-up
    { duration: soakDuration,   target: 20 }, // sustained soak
    { duration: '2m',           target: 0  }, // cooldown
  ],
  thresholds: {
    // During soak, latency should remain STABLE (not creeping up)
    http_req_duration: ['p(95)<1000', 'p(99)<3000'],
    http_req_failed:   ['rate<0.05'],
  },
};

export function setup() {
  const token = getAuthToken();
  if (!token) throw new Error('Setup failed: could not obtain auth token');
  return { token };
}

export default function (data) {
  const { token } = data;
  const headers = authHeaders(token);

  // Balanced mix of operations — representative of sustained usage
  const action = Math.random();

  if (action < 0.10) {
    // CREATE incident — database write
    const res = http.post(
      `${BASE_URL}/api/incidents`,
      JSON.stringify(randomIncidentPayload()),
      { headers },
    );
    check(res, {
      'soak create 201': (r) => r.status === 201 || r.status === 429,
    });

  } else if (action < 0.35) {
    // LIST incidents paginated
    const res = http.get(
      `${BASE_URL}/api/incidents?page=1&limit=20`,
      { headers },
    );
    check(res, { 'soak list incidents': (r) => r.status === 200 });

  } else if (action < 0.55) {
    // LIST resources — cache benefit on repeated calls
    const res = http.get(
      `${BASE_URL}/api/resources?page=1&limit=20`,
      { headers },
    );
    check(res, { 'soak list resources': (r) => r.status === 200 });

  } else if (action < 0.70) {
    // LIST hospitals — cache benefit
    const res = http.get(
      `${BASE_URL}/api/hospitals?page=1&limit=20`,
      { headers },
    );
    check(res, { 'soak list hospitals': (r) => r.status === 200 });

  } else if (action < 0.85) {
    // LIST assignments paginated
    const res = http.get(
      `${BASE_URL}/api/assignments?page=1&limit=20`,
      { headers },
    );
    check(res, { 'soak list assignments': (r) => r.status === 200 });

  } else {
    // Health check — should always be fast
    const health = http.get(`${BASE_URL}/health`);
    check(health, { 'soak health': (r) => r.status === 200 });
  }

  sleep(randomInt(1, 3));
}

// ─── Teardown: report summary stats ──────────────────────────────────────────

export function teardown(data) {
  const { token } = data;
  if (!token) return;

  const headers = authHeaders(token);

  // Check readiness after soak — should still be ready
  const ready = http.get(`${BASE_URL}/ready`, { headers });
  const readyBody = JSON.parse(ready.body || '{}');

  console.log('=== SOAK TEST TEARDOWN ===');
  console.log(`Readiness status: ${readyBody.status}`);
  console.log(`DB status: ${readyBody.dependencies?.database?.status} (${readyBody.dependencies?.database?.latencyMs}ms)`);
  console.log(`Redis status: ${readyBody.dependencies?.redis?.status} (${readyBody.dependencies?.redis?.latencyMs}ms)`);
  console.log(`Cache status: ${readyBody.dependencies?.cache?.status}`);
  console.log('Monitor: process memory, DB connections, Redis memory for leak indicators');
}
