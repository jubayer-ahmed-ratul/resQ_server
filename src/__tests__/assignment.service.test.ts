/**
 * Assignment Service — Unit + Integration + Concurrency tests
 *
 * These tests use jest.mock to replace prisma so no real DB is required.
 * The concurrency test uses Promise.all to simulate simultaneous requests
 * and verifies that exactly one succeeds.
 */

import {
  ASSIGNMENT_ERRORS,
  ALLOWED_ASSIGNMENT_TRANSITIONS,
} from '../modules/assignment/assignment.interface';

// ─── Mock prisma ──────────────────────────────────────────────────────────────

const mockAssignmentFindFirst = jest.fn();
const mockAssignmentCreate = jest.fn();
const mockAssignmentUpdate = jest.fn();
const mockAssignmentFindUnique = jest.fn();
const mockAssignmentFindMany = jest.fn();
const mockIncidentFindUnique = jest.fn();
const mockIncidentUpdate = jest.fn();
const mockResourceFindUnique = jest.fn();
const mockResourceUpdate = jest.fn();
// DecisionLog mock — Part 8: assignment.service creates a DecisionLog
// inside the same transaction as the assignment. The tx mock must include it.
const mockDecisionLogCreate = jest.fn();

// $transaction executes the callback with a tx object that mirrors prisma
jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        incident: {
          findUnique: mockIncidentFindUnique,
          update: mockIncidentUpdate,
        },
        resource: {
          findUnique: mockResourceFindUnique,
          update: mockResourceUpdate,
        },
        assignment: {
          findFirst: mockAssignmentFindFirst,
          create: mockAssignmentCreate,
          update: mockAssignmentUpdate,
          findUnique: mockAssignmentFindUnique,
          findMany: mockAssignmentFindMany,
        },
        // Part 8 — DecisionLog must be present in the transaction context
        decisionLog: {
          create: mockDecisionLogCreate,
        },
        // Part 10 — OutboxEvent must be present in the transaction context
        outboxEvent: {
          create: jest.fn().mockResolvedValue({ id: 'outbox-tx' }),
        },
      };
      return cb(tx);
    }),
    assignment: {
      findUnique: mockAssignmentFindUnique,
      findMany: mockAssignmentFindMany,
    },
  },
}));

import * as assignmentService from '../modules/assignment/assignment.service';
import { AppError } from '../utils/errors';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const INCIDENT_ID = 'incident-001';
const RESOURCE_ID = 'resource-A12';
const ASSIGNMENT_ID = 'assignment-001';

const mockIncident = (overrides = {}) => ({
  id: INCIDENT_ID,
  status: 'VALIDATED',
  affectedPeople: 4,
  resourceRequirements: ['AMBULANCE'],
  ...overrides,
});

const mockResource = (overrides = {}) => ({
  id: RESOURCE_ID,
  type: 'AMBULANCE',
  status: 'AVAILABLE',
  capacity: 10,
  ...overrides,
});

const mockAssignment = (overrides = {}) => ({
  id: ASSIGNMENT_ID,
  incidentId: INCIDENT_ID,
  resourceId: RESOURCE_ID,
  status: 'ACTIVE',
  assignedAt: new Date(),
  releasedAt: null,
  incident: { id: INCIDENT_ID, title: 'Test', status: 'ASSIGNED' },
  resource: { id: RESOURCE_ID, name: 'A-12', type: 'AMBULANCE', status: 'BUSY' },
  ...overrides,
});

// ─── Helper: reset all mocks ──────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Interface tests (no DB needed)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Assignment status transitions (interface)', () => {
  test('PENDING can transition to ACTIVE or CANCELLED', () => {
    expect(ALLOWED_ASSIGNMENT_TRANSITIONS['PENDING']).toContain('ACTIVE');
    expect(ALLOWED_ASSIGNMENT_TRANSITIONS['PENDING']).toContain('CANCELLED');
  });

  test('ACTIVE can transition to COMPLETED or CANCELLED', () => {
    expect(ALLOWED_ASSIGNMENT_TRANSITIONS['ACTIVE']).toContain('COMPLETED');
    expect(ALLOWED_ASSIGNMENT_TRANSITIONS['ACTIVE']).toContain('CANCELLED');
  });

  test('COMPLETED is terminal — no further transitions', () => {
    expect(ALLOWED_ASSIGNMENT_TRANSITIONS['COMPLETED']).toHaveLength(0);
  });

  test('CANCELLED is terminal — no further transitions', () => {
    expect(ALLOWED_ASSIGNMENT_TRANSITIONS['CANCELLED']).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Create assignment tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('createAssignment()', () => {

  // TEST 1: Happy path — AVAILABLE resource assigned successfully
  test('TEST 1: AVAILABLE resource → assignment created', async () => {
    mockIncidentFindUnique.mockResolvedValue(mockIncident());
    mockResourceFindUnique.mockResolvedValue(mockResource());
    mockAssignmentFindFirst.mockResolvedValue(null); // no conflicts
    mockAssignmentCreate.mockResolvedValue(mockAssignment());
    mockResourceUpdate.mockResolvedValue({});
    mockIncidentUpdate.mockResolvedValue({});
    // Part 8: DecisionLog is created inside the same tx — must be mocked
    mockDecisionLogCreate.mockResolvedValue({ id: 'decision-001' });

    const result = await assignmentService.createAssignment({
      incidentId: INCIDENT_ID,
      resourceId: RESOURCE_ID,
    });

    expect(result.id).toBe(ASSIGNMENT_ID);
    expect(mockResourceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'BUSY' } }),
    );
    expect(mockIncidentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ASSIGNED' } }),
    );
    // Part 8: Verify DecisionLog was created for the assignment
    expect(mockDecisionLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: INCIDENT_ID,
          selectedResourceId: RESOURCE_ID,
          decisionType: 'RESOURCE_ASSIGNMENT',
        }),
      }),
    );
  });

  // TEST 2: Incident not found
  test('TEST 2: Incident not found → 404', async () => {
    mockIncidentFindUnique.mockResolvedValue(null);
    await expect(
      assignmentService.createAssignment({ incidentId: 'bad-id', resourceId: RESOURCE_ID }),
    ).rejects.toThrow(AppError);
  });

  // TEST 3: Incident not eligible (PENDING status)
  test('TEST 3: PENDING incident not eligible → CONFLICT', async () => {
    mockIncidentFindUnique.mockResolvedValue(mockIncident({ status: 'PENDING' }));
    await expect(
      assignmentService.createAssignment({ incidentId: INCIDENT_ID, resourceId: RESOURCE_ID }),
    ).rejects.toThrow(AppError);
  });

  // TEST 4: Resource not found
  test('TEST 4: Resource not found → 404', async () => {
    mockIncidentFindUnique.mockResolvedValue(mockIncident());
    mockResourceFindUnique.mockResolvedValue(null);
    await expect(
      assignmentService.createAssignment({ incidentId: INCIDENT_ID, resourceId: 'bad-id' }),
    ).rejects.toThrow(AppError);
  });

  // TEST 5: Resource is BUSY → rejected
  test('TEST 5: BUSY resource → CONFLICT', async () => {
    mockIncidentFindUnique.mockResolvedValue(mockIncident());
    mockResourceFindUnique.mockResolvedValue(mockResource({ status: 'BUSY' }));
    await expect(
      assignmentService.createAssignment({ incidentId: INCIDENT_ID, resourceId: RESOURCE_ID }),
    ).rejects.toThrow(ASSIGNMENT_ERRORS.RESOURCE_NOT_AVAILABLE);
  });

  // TEST 6: Resource is FAILED → rejected
  test('TEST 6: FAILED resource → CONFLICT', async () => {
    mockIncidentFindUnique.mockResolvedValue(mockIncident());
    mockResourceFindUnique.mockResolvedValue(mockResource({ status: 'FAILED' }));
    await expect(
      assignmentService.createAssignment({ incidentId: INCIDENT_ID, resourceId: RESOURCE_ID }),
    ).rejects.toThrow(ASSIGNMENT_ERRORS.RESOURCE_NOT_AVAILABLE);
  });

  // TEST 7: Resource is MAINTENANCE → rejected
  test('TEST 7: MAINTENANCE resource → CONFLICT', async () => {
    mockIncidentFindUnique.mockResolvedValue(mockIncident());
    mockResourceFindUnique.mockResolvedValue(mockResource({ status: 'MAINTENANCE' }));
    await expect(
      assignmentService.createAssignment({ incidentId: INCIDENT_ID, resourceId: RESOURCE_ID }),
    ).rejects.toThrow(ASSIGNMENT_ERRORS.RESOURCE_NOT_AVAILABLE);
  });

  // TEST 8: Resource type mismatch → rejected
  test('TEST 8: Wrong resource type → CONFLICT', async () => {
    mockIncidentFindUnique.mockResolvedValue(mockIncident({ resourceRequirements: ['AMBULANCE'] }));
    mockResourceFindUnique.mockResolvedValue(mockResource({ type: 'HELICOPTER' }));
    await expect(
      assignmentService.createAssignment({ incidentId: INCIDENT_ID, resourceId: RESOURCE_ID }),
    ).rejects.toThrow(ASSIGNMENT_ERRORS.RESOURCE_TYPE_MISMATCH);
  });

  // TEST 9: Insufficient capacity → rejected
  test('TEST 9: Insufficient capacity → CONFLICT', async () => {
    mockIncidentFindUnique.mockResolvedValue(mockIncident({ affectedPeople: 20 }));
    mockResourceFindUnique.mockResolvedValue(mockResource({ capacity: 4 }));
    await expect(
      assignmentService.createAssignment({ incidentId: INCIDENT_ID, resourceId: RESOURCE_ID }),
    ).rejects.toThrow(ASSIGNMENT_ERRORS.RESOURCE_CAPACITY_INSUFFICIENT);
  });

  // TEST 10: Resource already has ACTIVE assignment → rejected
  test('TEST 10: Resource already assigned → CONFLICT', async () => {
    mockIncidentFindUnique.mockResolvedValue(mockIncident());
    mockResourceFindUnique.mockResolvedValue(mockResource());
    // first findFirst (resourceId check) → has active assignment
    mockAssignmentFindFirst.mockResolvedValueOnce(mockAssignment());
    await expect(
      assignmentService.createAssignment({ incidentId: INCIDENT_ID, resourceId: RESOURCE_ID }),
    ).rejects.toThrow(ASSIGNMENT_ERRORS.RESOURCE_ALREADY_ASSIGNED);
  });

  // TEST 11: Incident already has ACTIVE assignment → rejected
  test('TEST 11: Incident already assigned → CONFLICT', async () => {
    mockIncidentFindUnique.mockResolvedValue(mockIncident());
    mockResourceFindUnique.mockResolvedValue(mockResource());
    // first findFirst (resourceId check) → null (no resource conflict)
    // second findFirst (incidentId check) → existing active assignment
    mockAssignmentFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockAssignment());
    // create should NOT be reached, but set a fallback just in case
    mockAssignmentCreate.mockResolvedValue(mockAssignment());
    mockResourceUpdate.mockResolvedValue({});
    mockIncidentUpdate.mockResolvedValue({});
    await expect(
      assignmentService.createAssignment({ incidentId: INCIDENT_ID, resourceId: RESOURCE_ID }),
    ).rejects.toThrow(ASSIGNMENT_ERRORS.INCIDENT_ALREADY_ASSIGNED);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Complete assignment tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('completeAssignment()', () => {

  test('TEST 12: ACTIVE assignment → COMPLETED, resource → AVAILABLE, incident → DISPATCHED', async () => {
    mockAssignmentFindUnique.mockResolvedValue(mockAssignment({ status: 'ACTIVE' }));
    mockAssignmentUpdate.mockResolvedValue(mockAssignment({ status: 'COMPLETED', releasedAt: new Date() }));
    mockResourceUpdate.mockResolvedValue({});
    mockIncidentUpdate.mockResolvedValue({});

    const result = await assignmentService.completeAssignment(ASSIGNMENT_ID);

    expect(result.status).toBe('COMPLETED');
    expect(result.releasedAt).toBeTruthy();
    expect(mockResourceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'AVAILABLE' } }),
    );
    expect(mockIncidentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'DISPATCHED' } }),
    );
  });

  test('TEST 13: COMPLETED assignment cannot be completed again → 400', async () => {
    mockAssignmentFindUnique.mockResolvedValue(mockAssignment({ status: 'COMPLETED' }));
    await expect(
      assignmentService.completeAssignment(ASSIGNMENT_ID),
    ).rejects.toThrow(ASSIGNMENT_ERRORS.INVALID_ASSIGNMENT_STATE);
  });

  test('TEST 14: CANCELLED assignment cannot be completed → 400', async () => {
    mockAssignmentFindUnique.mockResolvedValue(mockAssignment({ status: 'CANCELLED' }));
    await expect(
      assignmentService.completeAssignment(ASSIGNMENT_ID),
    ).rejects.toThrow(ASSIGNMENT_ERRORS.INVALID_ASSIGNMENT_STATE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cancel assignment tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('cancelAssignment()', () => {

  test('TEST 15: ACTIVE assignment → CANCELLED, resource → AVAILABLE, incident → PROCESSING', async () => {
    mockAssignmentFindUnique.mockResolvedValue(mockAssignment({ status: 'ACTIVE' }));
    mockAssignmentUpdate.mockResolvedValue(mockAssignment({ status: 'CANCELLED', releasedAt: new Date() }));
    mockResourceUpdate.mockResolvedValue({});
    mockIncidentFindUnique.mockResolvedValue(mockIncident({ status: 'ASSIGNED' }));
    mockIncidentUpdate.mockResolvedValue({});

    const result = await assignmentService.cancelAssignment(ASSIGNMENT_ID);

    expect(result.status).toBe('CANCELLED');
    expect(result.releasedAt).toBeTruthy();
    expect(mockResourceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'AVAILABLE' } }),
    );
    expect(mockIncidentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PROCESSING' } }),
    );
  });

  test('TEST 16: COMPLETED assignment cannot be cancelled → 400', async () => {
    mockAssignmentFindUnique.mockResolvedValue(mockAssignment({ status: 'COMPLETED' }));
    await expect(
      assignmentService.cancelAssignment(ASSIGNMENT_ID),
    ).rejects.toThrow(ASSIGNMENT_ERRORS.INVALID_ASSIGNMENT_STATE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Concurrency / race condition test
// ═══════════════════════════════════════════════════════════════════════════════

describe('Concurrency — race condition prevention', () => {

  test('TEST 17: Two simultaneous requests for same resource → exactly one succeeds', async () => {
    // Simulate: first call sees no conflict, second call sees the first assignment
    let callCount = 0;

    const txMock = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      callCount++;
      const isFirst = callCount === 1;

      const tx = {
        incident: {
          findUnique: jest.fn().mockResolvedValue(mockIncident()),
          update: jest.fn().mockResolvedValue({}),
        },
        resource: {
          findUnique: jest.fn().mockResolvedValue(mockResource()),
          update: jest.fn().mockResolvedValue({}),
        },
        assignment: {
          findFirst: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
            // Second request sees the first's resource assignment
            if (!isFirst && where['resourceId']) {
              return Promise.resolve(mockAssignment());
            }
            return Promise.resolve(null);
          }),
          create: jest.fn().mockResolvedValue(mockAssignment()),
        },
        // Part 8 — DecisionLog inside transaction
        decisionLog: {
          create: jest.fn().mockResolvedValue({ id: 'decision-concurrency' }),
        },
        // Part 10 — OutboxEvent inside transaction
        outboxEvent: {
          create: jest.fn().mockResolvedValue({ id: 'outbox-concurrency' }),
        },
      };
      return cb(tx);
    });

    // Temporarily override $transaction
    const prisma = (await import('../lib/prisma')).default;
    (prisma.$transaction as jest.Mock).mockImplementation(txMock);

    const [result1, result2] = await Promise.allSettled([
      assignmentService.createAssignment({ incidentId: 'inc-A', resourceId: RESOURCE_ID }),
      assignmentService.createAssignment({ incidentId: 'inc-B', resourceId: RESOURCE_ID }),
    ]);

    const succeeded = [result1, result2].filter((r) => r.status === 'fulfilled');
    const failed = [result1, result2].filter((r) => r.status === 'rejected');

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const failedReason = (failed[0] as PromiseRejectedResult).reason as AppError;
    expect(failedReason.message).toBe(ASSIGNMENT_ERRORS.RESOURCE_ALREADY_ASSIGNED);
  });

});
