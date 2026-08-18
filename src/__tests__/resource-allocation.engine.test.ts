import {
  recommendResource,
  haversineDistanceKm,
  estimateEtaMinutes,
} from '../modules/decision/resource-allocation.engine';
import {
  AllocationEngineInput,
  ResourceCandidate,
} from '../modules/decision/decision.interface';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const INCIDENT_LAT = 23.8103;
const INCIDENT_LON = 90.4125;
const SPEED = 60; // km/h

const makeInput = (
  resources: ResourceCandidate[],
  overrides: Partial<AllocationEngineInput> = {},
): AllocationEngineInput => ({
  incidentId: 'incident-001',
  incidentLatitude: INCIDENT_LAT,
  incidentLongitude: INCIDENT_LON,
  affectedPeople: 4,
  resourceRequirements: ['AMBULANCE'],
  availableResources: resources,
  averageSpeedKmh: SPEED,
  ...overrides,
});

const makeResource = (
  overrides: Partial<ResourceCandidate> & { id: string },
): ResourceCandidate => ({
  name: `Resource-${overrides.id}`,
  type: 'AMBULANCE',
  status: 'AVAILABLE',
  capacity: 10,
  latitude: INCIDENT_LAT + 0.05,
  longitude: INCIDENT_LON,
  ...overrides,
});

// ─── Haversine & ETA helpers ──────────────────────────────────────────────────

describe('Haversine & ETA helpers', () => {
  test('Same point → 0 km', () => {
    expect(haversineDistanceKm(23.8103, 90.4125, 23.8103, 90.4125)).toBe(0);
  });

  test('Known distance — Dhaka to ~5km north is ~5.5 km', () => {
    const d = haversineDistanceKm(23.8103, 90.4125, 23.8553, 90.4125);
    expect(d).toBeGreaterThan(4);
    expect(d).toBeLessThan(7);
  });

  test('ETA at 60 km/h for 30 km → 30 minutes', () => {
    expect(estimateEtaMinutes(30, 60)).toBe(30);
  });

  test('ETA with zero speed → Infinity', () => {
    expect(estimateEtaMinutes(10, 0)).toBe(Infinity);
  });
});

// ─── Allocation engine tests ──────────────────────────────────────────────────

describe('Resource Allocation Engine — recommendResource()', () => {

  // TEST 1: One available suitable ambulance → selected
  test('TEST 1: One AVAILABLE AMBULANCE → selected', () => {
    const r = makeResource({ id: 'A-01' });
    const result = recommendResource(makeInput([r]));
    expect(result.selectedResource).not.toBeNull();
    expect(result.selectedResource?.id).toBe('A-01');
  });

  // TEST 2: Two available ambulances → lower ETA selected
  test('TEST 2: Two AVAILABLE ambulances → lower ETA selected', () => {
    const near = makeResource({ id: 'A-01', latitude: INCIDENT_LAT + 0.02 }); // closer
    const far  = makeResource({ id: 'A-02', latitude: INCIDENT_LAT + 0.20 }); // farther
    const result = recommendResource(makeInput([near, far]));
    expect(result.selectedResource?.id).toBe('A-01');
  });

  // TEST 3: Closest ambulance is BUSY → rejected, next selected
  test('TEST 3: BUSY resource rejected, AVAILABLE fallback selected', () => {
    const busy = makeResource({ id: 'A-01', status: 'BUSY', latitude: INCIDENT_LAT + 0.01 });
    const avail = makeResource({ id: 'A-02', latitude: INCIDENT_LAT + 0.10 });
    const result = recommendResource(makeInput([busy, avail]));
    expect(result.selectedResource?.id).toBe('A-02');
    expect(result.rejectedCandidates.some((r) => r.resourceId === 'A-01')).toBe(true);
  });

  // TEST 4: Resource capacity insufficient → rejected
  test('TEST 4: Insufficient capacity → resource rejected', () => {
    const small = makeResource({ id: 'A-01', capacity: 2 }); // affectedPeople = 4
    const result = recommendResource(makeInput([small]));
    expect(result.selectedResource).toBeNull();
    expect(result.rejectedCandidates[0]?.reason).toMatch(/capacity/i);
  });

  // TEST 5: Wrong resource type → rejected
  test('TEST 5: Wrong type (HELICOPTER) rejected for AMBULANCE requirement', () => {
    const heli = makeResource({ id: 'H-01', type: 'HELICOPTER' });
    const result = recommendResource(makeInput([heli]));
    expect(result.selectedResource).toBeNull();
    expect(result.rejectedCandidates[0]?.reason).toMatch(/type/i);
  });

  // TEST 6: FAILED resource → rejected
  test('TEST 6: FAILED resource rejected', () => {
    const failed = makeResource({ id: 'A-01', status: 'FAILED' });
    const result = recommendResource(makeInput([failed]));
    expect(result.selectedResource).toBeNull();
    expect(result.rejectedCandidates[0]?.reason).toMatch(/FAILED/);
  });

  // TEST 7: MAINTENANCE resource → rejected
  test('TEST 7: MAINTENANCE resource rejected', () => {
    const maintenance = makeResource({ id: 'A-01', status: 'MAINTENANCE' });
    const result = recommendResource(makeInput([maintenance]));
    expect(result.selectedResource).toBeNull();
    expect(result.rejectedCandidates[0]?.reason).toMatch(/MAINTENANCE/);
  });

  // TEST 8: No resources at all → selectedResource = null with explanation
  test('TEST 8: No resources → selectedResource null', () => {
    const result = recommendResource(makeInput([]));
    expect(result.selectedResource).toBeNull();
    expect(result.message).toBeTruthy();
  });

  // TEST 9: Equal ETA → deterministic tie-breaking by capacity fit then ID
  test('TEST 9: Equal ETA → deterministic tie-break (better capacity fit wins)', () => {
    // Both at exactly the same location → same ETA
    const bigCap  = makeResource({ id: 'A-02', capacity: 20, latitude: INCIDENT_LAT + 0.05 });
    const fitCap  = makeResource({ id: 'A-01', capacity: 5,  latitude: INCIDENT_LAT + 0.05 });
    const result = recommendResource(makeInput([bigCap, fitCap]));
    // fitCap has capacityFit = 1, bigCap has capacityFit = 16 → fitCap wins
    expect(result.selectedResource?.id).toBe('A-01');
  });

  // TEST 10: Recommendation must NOT change resource status
  test('TEST 10: Recommendation is read-only — resource status unchanged', () => {
    const r = makeResource({ id: 'A-01', status: 'AVAILABLE' });
    recommendResource(makeInput([r]));
    // Resource object is not mutated
    expect(r.status).toBe('AVAILABLE');
  });

  // TEST 11: Result contains all required fields
  test('TEST 11: Result structure contains all required fields', () => {
    const r = makeResource({ id: 'A-01' });
    const result = recommendResource(makeInput([r]));
    expect(result).toHaveProperty('incidentId');
    expect(result).toHaveProperty('selectedResource');
    expect(result).toHaveProperty('estimatedDistanceKm');
    expect(result).toHaveProperty('estimatedEtaMinutes');
    expect(result).toHaveProperty('reasons');
    expect(result).toHaveProperty('rejectedCandidates');
    expect(result).toHaveProperty('candidateEvaluations');
    expect(result).toHaveProperty('message');
  });

  // TEST 12: Same input → same result (determinism)
  test('TEST 12: Same input produces identical result (deterministic)', () => {
    const resources = [
      makeResource({ id: 'A-01', latitude: INCIDENT_LAT + 0.05 }),
      makeResource({ id: 'A-02', latitude: INCIDENT_LAT + 0.10 }),
    ];
    const input = makeInput(resources);
    const r1 = recommendResource(input);
    const r2 = recommendResource(input);
    expect(r1.selectedResource?.id).toBe(r2.selectedResource?.id);
    expect(r1.estimatedEtaMinutes).toBe(r2.estimatedEtaMinutes);
  });

  // TEST 13: Example from spec — A-20 BUSY rejected, A-12 selected over A-15
  test('TEST 13: Spec example — BUSY rejected, nearest AVAILABLE selected', () => {
    const A12 = makeResource({ id: 'A-12', latitude: INCIDENT_LAT + 0.03 }); // nearby
    const A15 = makeResource({ id: 'A-15', latitude: INCIDENT_LAT + 0.15 }); // farther
    const A20 = makeResource({ id: 'A-20', status: 'BUSY', latitude: INCIDENT_LAT + 0.01 }); // nearest but BUSY
    const result = recommendResource(makeInput([A12, A15, A20]));
    expect(result.selectedResource?.id).toBe('A-12');
    expect(result.rejectedCandidates.some((r) => r.resourceId === 'A-20')).toBe(true);
  });

});
