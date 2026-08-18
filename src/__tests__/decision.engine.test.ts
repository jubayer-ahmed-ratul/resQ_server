import { calculatePriority } from '../modules/decision/decision.engine';
import { PriorityEngineInput } from '../modules/decision/decision.interface';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeInput = (overrides: Partial<PriorityEngineInput> = {}): PriorityEngineInput => ({
  severity: 'MEDIUM',
  timeSensitivity: 'MEDIUM',
  affectedPeople: 10,
  environmentalCondition: null,
  resourceRequirements: [],
  ...overrides,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Priority Engine — calculatePriority()', () => {

  // TEST 1: Low severity + low urgency + small population → low score
  test('TEST 1: LOW severity + LOW time sensitivity + 1 person → low score', () => {
    const result = calculatePriority(makeInput({
      severity: 'LOW',
      timeSensitivity: 'LOW',
      affectedPeople: 1,
      environmentalCondition: 'clear',
      resourceRequirements: [],
    }));
    expect(result.priorityScore).toBeLessThan(40);
  });

  // TEST 2: CRITICAL severity + CRITICAL urgency + large population → high score
  test('TEST 2: CRITICAL severity + CRITICAL time sensitivity + 200 people → high score', () => {
    const result = calculatePriority(makeInput({
      severity: 'CRITICAL',
      timeSensitivity: 'CRITICAL',
      affectedPeople: 200,
      environmentalCondition: 'Severe flooding',
      resourceRequirements: ['AMBULANCE', 'RESCUE_TEAM', 'HELICOPTER'],
    }));
    expect(result.priorityScore).toBeGreaterThan(80);
  });

  // TEST 3: Large population — score must be capped at 100
  test('TEST 3: Very large population (10000) → population score capped at 100', () => {
    const result = calculatePriority(makeInput({ affectedPeople: 10000 }));
    expect(result.factors.affectedPopulation.normalizedScore).toBe(100);
    expect(result.priorityScore).toBeLessThanOrEqual(100);
  });

  // TEST 4: High environmental risk raises score
  test('TEST 4: Severe flooding condition → higher score than no condition', () => {
    const withHazard = calculatePriority(makeInput({
      environmentalCondition: 'Severe flooding and road blockage',
    }));
    const withoutHazard = calculatePriority(makeInput({
      environmentalCondition: 'clear',
    }));
    expect(withHazard.priorityScore).toBeGreaterThan(withoutHazard.priorityScore);
  });

  // TEST 5: Helicopter + rescue team → resource score is high
  test('TEST 5: HELICOPTER + RESCUE_TEAM requirements → high resource normalized score', () => {
    const result = calculatePriority(makeInput({
      resourceRequirements: ['HELICOPTER', 'RESCUE_TEAM'],
    }));
    expect(result.factors.resourceRequirements.normalizedScore).toBeGreaterThanOrEqual(85);
  });

  // TEST 6: Maximum possible inputs → score must not exceed 100
  test('TEST 6: Maximum inputs → priorityScore <= 100', () => {
    const result = calculatePriority(makeInput({
      severity: 'CRITICAL',
      timeSensitivity: 'CRITICAL',
      affectedPeople: 99999,
      environmentalCondition: 'explosion and collapse',
      resourceRequirements: ['HELICOPTER', 'RESCUE_TEAM', 'AMBULANCE', 'MEDICAL_SUPPORT', 'HAZMAT_UNIT'],
    }));
    expect(result.priorityScore).toBeLessThanOrEqual(100);
  });

  // TEST 7: Minimum possible inputs → score must not be below 0
  test('TEST 7: Minimum inputs → priorityScore >= 0', () => {
    const result = calculatePriority(makeInput({
      severity: 'LOW',
      timeSensitivity: 'LOW',
      affectedPeople: 0,
      environmentalCondition: null,
      resourceRequirements: [],
    }));
    expect(result.priorityScore).toBeGreaterThanOrEqual(0);
  });

  // TEST 8: Same input twice → same score (determinism)
  test('TEST 8: Same input produces identical scores (deterministic)', () => {
    const input = makeInput({
      severity: 'HIGH',
      timeSensitivity: 'CRITICAL',
      affectedPeople: 45,
      environmentalCondition: 'Heavy rain and traffic',
      resourceRequirements: ['AMBULANCE', 'MEDICAL_SUPPORT'],
    });
    const result1 = calculatePriority(input);
    const result2 = calculatePriority(input);
    expect(result1.priorityScore).toBe(result2.priorityScore);
  });

  // TEST 9: Breakdown structure integrity
  test('TEST 9: Result contains all factor keys and reasons array', () => {
    const result = calculatePriority(makeInput());
    expect(result).toHaveProperty('priorityScore');
    expect(result).toHaveProperty('factors.severity');
    expect(result).toHaveProperty('factors.timeSensitivity');
    expect(result).toHaveProperty('factors.affectedPopulation');
    expect(result).toHaveProperty('factors.environmentalRisk');
    expect(result).toHaveProperty('factors.resourceRequirements');
    expect(result.reasons).toHaveLength(5);
  });

  // TEST 10: Example incident from spec
  test('TEST 10: Spec example (CRITICAL + CRITICAL + 100 people + severe flooding + 3 resources) → high score with explanation', () => {
    const result = calculatePriority({
      severity: 'CRITICAL',
      timeSensitivity: 'CRITICAL',
      affectedPeople: 100,
      environmentalCondition: 'Severe flooding and road blockage',
      resourceRequirements: ['AMBULANCE', 'RESCUE_TEAM', 'HELICOPTER'],
    });

    expect(result.priorityScore).toBeGreaterThan(85);
    expect(result.factors.severity.weightedScore).toBe(30);       // 100 * 0.30
    expect(result.factors.timeSensitivity.weightedScore).toBe(25); // 100 * 0.25
    expect(result.reasons.length).toBeGreaterThan(0);
    // Every reason must be a non-empty string
    result.reasons.forEach((r) => expect(typeof r).toBe('string'));
  });

});
