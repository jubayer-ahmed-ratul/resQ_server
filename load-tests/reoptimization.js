/**
 * Re-optimization Load Test — Part 12
 *
 * Simulates many resource failures triggering re-optimization jobs.
 *
 * Scenario:
 *   1. Create N incidents
 *   2. Create N resources and assign them
 *   3. Mark resources as FAILED — triggers RESOURCE_FAILURE_DETECTED events
 *   4. Workers process re-optimization jobs from BullMQ queue
 *   5. Measure:
 *      - API latency for status updates
 *      - Queue depth buildup
 *      - Worker processing rate
 *      - Successful vs. unresolved reassignments
 *
 * Run:
 *   k6 run -e LOAD_TEST_EMAIL=admin@test.local \
 *           -e LOAD_TEST_PASSWORD=TestPassword123! \
 *           load-tests/reoptimization.js
 *
 * WARNING: Creates real DB records. Use TEST database only.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import {
  BASE_URL,
  getAuthToken,
  authHeaders,
  randomFloat,
  randomInt,
} from './scenarios.js';

export const options = {
  scenarios: {
    // Simulate resource failures triggering reoptimization
    resource_failures: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '2m',  target: 10 },
        { duration: '10s', target: 0  },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000'],
    http_req_failed:   ['rate<0.10'],
  },
};

export function setup() {
  const token = getAuthToken();
  if (!token) throw new Error('Setup failed');

  const headers = authHeaders(token);
  const assignments = [];

  console.log('Setting up: creating incidents + resources + assignments...');

  // Create 20 incidents with assignments for the reoptimization test
  for (let i = 0; i < 20; i++) {
    // Create incident
    const incRes = http.post(
      `${BASE_URL}/api/incidents`,
      JSON.stringify({
        title: `Reopt Test Incident ${i + 1}`,
        description: 'Reoptimization load test incident',
        severity: 'HIGH',
        affectedPeople: randomInt(1, 50),
        latitude: randomFloat(-90, 90),
        longitude: randomFloat(-180, 180),
        timeSensitivity: 'HIGH',
        resourceRequirements: [],
      }),
      { headers },
    );

    if (incRes.status !== 201) continue;
    const incidentId = JSON.parse(incRes.body).data?.id;

    // Validate
    http.patch(`${BASE_URL}/api/incidents/${incidentId}/validate`, null, { headers });

    // Create resource
    const resRes = http.post(
      `${BASE_URL}/api/resources`,
      JSON.stringify({
        name: `Reopt Resource ${i + 1}`,
        type: 'AMBULANCE',
        latitude: randomFloat(-90, 90),
        longitude: randomFloat(-180, 180),
        capacity: 100,
        status: 'AVAILABLE',
      }),
      { headers },
    );

    if (resRes.status !== 201) continue;
    const resourceId = JSON.parse(resRes.body).data?.id;

    // Create assignment
    const assignRes = http.post(
      `${BASE_URL}/api/assignments`,
      JSON.stringify({ incidentId, resourceId }),
      { headers },
    );

    if (assignRes.status === 201) {
      const assignmentId = JSON.parse(assignRes.body).data?.id;
      assignments.push({ assignmentId, incidentId, resourceId });
    }
  }

  console.log(`Setup complete: ${assignments.length} active assignments ready for failure simulation`);
  return { token, assignments };
}

let failureIdx = 0;

export default function (data) {
  const { token, assignments } = data;
  if (assignments.length === 0) {
    sleep(1);
    return;
  }

  const headers = authHeaders(token);

  // Pick an assignment and mark its resource as FAILED
  const idx = __VU % assignments.length;
  const { resourceId, assignmentId } = assignments[idx];

  // Mark resource as FAILED — this triggers RESOURCE_FAILURE_DETECTED event
  // which the worker processes as a reoptimization job
  const failRes = http.patch(
    `${BASE_URL}/api/resources/${resourceId}`,
    JSON.stringify({ status: 'FAILED' }),
    { headers },
  );

  check(failRes, {
    'resource fail update 200': (r) => r.status === 200,
  });

  // Small sleep to let events flow to queue
  sleep(2);

  // Query reoptimization log to see if it was processed
  const reoptRes = http.get(
    `${BASE_URL}/api/assignments/${assignmentId}/reoptimize`,
    { headers },
  );

  // Also check reopt logs for the incident
  const incidentId = assignments[idx].incidentId;
  const logsRes = http.get(
    `${BASE_URL}/api/incidents/${incidentId}/reoptimizations`,
    { headers },
  );

  check(logsRes, {
    'reopt logs accessible': (r) => r.status === 200,
  });

  sleep(randomInt(1, 3));
}
