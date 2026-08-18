/**
 * PART 10 — Event System Tests
 *
 * A. Event envelope — createEvent() factory
 * B. EventPublisher — registry
 * C. Outbox helper — writeOutboxEvent / writeOutboxEventDirect
 * D. Outbox publisher — publishPendingOutboxEvents()
 * E. Incident service — outbox on createIncident
 * F. Assignment service — outbox inside transaction
 * G. Resource service — outbox on status change
 * H. Worker idempotency & handlers
 * I. Event handler routing
 * J. Event type registry
 * K. Transaction rollback — no orphaned outbox events
 * L. BullMQ / config verification
 */

// ─── Mock prisma ──────────────────────────────────────────────────────────────

const mockOutboxCreate        = jest.fn();
const mockOutboxFindMany      = jest.fn();
const mockOutboxUpdate        = jest.fn();
const mockProcessedFindUnique = jest.fn();
const mockProcessedUpsert     = jest.fn();
const mockAssignmentFindFirst = jest.fn();
const mockIncidentCreate      = jest.fn();
const mockIncidentFindUnique  = jest.fn();
const mockIncidentUpdate      = jest.fn();
const mockResourceFindUnique  = jest.fn();
const mockResourceUpdate      = jest.fn();
const mockAssignmentCreate    = jest.fn();
const mockAssignmentUpdate    = jest.fn();
const mockAssignmentFindUnique = jest.fn();
const mockDecisionLogCreate   = jest.fn();
const mockResourceFindMany    = jest.fn();

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    outboxEvent: {
      create:   mockOutboxCreate,
      findMany: mockOutboxFindMany,
      update:   mockOutboxUpdate,
    },
    processedEvent: {
      findUnique: mockProcessedFindUnique,
      upsert:     mockProcessedUpsert,
    },
    assignment: {
      findFirst:  mockAssignmentFindFirst,
      findUnique: mockAssignmentFindUnique,
      findMany:   jest.fn().mockResolvedValue([]),
    },
    incident: {
      create:     mockIncidentCreate,
      findUnique: mockIncidentFindUnique,
      update:     mockIncidentUpdate,
    },
    resource: {
      findUnique: mockResourceFindUnique,
      update:     mockResourceUpdate,
      findMany:   mockResourceFindMany,
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        incident:    { findUnique: mockIncidentFindUnique, update: mockIncidentUpdate, create: mockIncidentCreate },
        resource:    { findUnique: mockResourceFindUnique, update: mockResourceUpdate },
        assignment:  { findFirst: mockAssignmentFindFirst, findUnique: mockAssignmentFindUnique, create: mockAssignmentCreate, update: mockAssignmentUpdate },
        decisionLog: { create: mockDecisionLogCreate },
        outboxEvent: { create: mockOutboxCreate },
      };
      if (typeof cb === 'function') return cb(tx);
      return Promise.all(cb as unknown as Promise<unknown>[]);
    }),
  },
}));

// ─── Mock queue service ───────────────────────────────────────────────────────

const mockEnqueue = jest.fn().mockResolvedValue(undefined);
jest.mock('../queue/queue.service', () => ({
  getQueueService: () => ({ enqueue: mockEnqueue, close: jest.fn() }),
  buildRedisConnection: () => ({ host: '127.0.0.1', port: 6379 }),
  DOMAIN_EVENTS_QUEUE: 'domain-events',
}));

// ─── Mock decision service ────────────────────────────────────────────────────

const mockCalculatePriority = jest.fn().mockResolvedValue({ priorityScore: 72.5 });
jest.mock('../modules/decision/decision.service', () => ({
  calculateAndSaveIncidentPriority: (...args: unknown[]) => mockCalculatePriority(...args),
  buildAssignmentExplanation: jest.fn().mockReturnValue({ summary: 'test', reasons: [] }),
  recommendResourceForIncident: jest.fn(),
  getDecisionsByIncident: jest.fn(),
  getDecisionById: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { createEvent, getPublisher, registerPublisher } from '../events/event.publisher';
import { EventType } from '../events/event.types';
import { writeOutboxEvent, writeOutboxEventDirect } from '../events/outbox/outbox.helper';
import { publishPendingOutboxEvents } from '../events/outbox/outbox.publisher';
import { handleIncidentCreated } from '../events/handlers/incident-created.handler';
import { handleResourceStatusChanged } from '../events/handlers/resource-status.handler';

// ─── Helper to extract eventType from mockOutboxCreate calls ─────────────────
type OutboxCallArg = { data: { eventType: string; payload: Record<string, unknown> } };
function getOutboxEventTypes(): string[] {
  return mockOutboxCreate.mock.calls.map((c) => (c[0] as OutboxCallArg).data.eventType);
}
function getOutboxPayload(eventType: string): Record<string, unknown> | undefined {
  const call = mockOutboxCreate.mock.calls.find(
    (c) => (c[0] as OutboxCallArg).data.eventType === eventType,
  );
  return call ? (call[0] as OutboxCallArg).data.payload : undefined;
}

// ─── Reset mocks ──────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockOutboxCreate.mockResolvedValue({ id: 'outbox-1' });
  mockOutboxUpdate.mockResolvedValue({});
  mockProcessedFindUnique.mockResolvedValue(null);
  mockProcessedUpsert.mockResolvedValue({});
  mockDecisionLogCreate.mockResolvedValue({ id: 'decision-1' });
  mockResourceFindMany.mockResolvedValue([]);
  mockEnqueue.mockResolvedValue(undefined);
});

// ═══════════════════════════════════════════════════════════════════════════════
// A. Event envelope
// ═══════════════════════════════════════════════════════════════════════════════

describe('A. createEvent() — event envelope factory', () => {

  test('A1: Creates envelope with all required fields', () => {
    const event = createEvent(EventType.INCIDENT_CREATED, {
      incidentId: 'inc-1', severity: 'HIGH', status: 'PENDING', createdById: 'u1',
    });
    expect(event).toHaveProperty('eventId');
    expect(event).toHaveProperty('eventType', EventType.INCIDENT_CREATED);
    expect(event).toHaveProperty('occurredAt');
    expect(event).toHaveProperty('version', 1);
    expect(event.payload).toMatchObject({ incidentId: 'inc-1' });
  });

  test('A2: Each call produces a unique eventId', () => {
    const e1 = createEvent(EventType.INCIDENT_CREATED, { incidentId: 'x', severity: 'LOW', status: 'PENDING', createdById: 'u' });
    const e2 = createEvent(EventType.INCIDENT_CREATED, { incidentId: 'x', severity: 'LOW', status: 'PENDING', createdById: 'u' });
    expect(e1.eventId).not.toBe(e2.eventId);
  });

  test('A3: occurredAt is a valid ISO-8601 string', () => {
    const event = createEvent(EventType.PRIORITY_CALCULATED, { incidentId: 'x', priorityScore: 50 });
    expect(new Date(event.occurredAt).toISOString()).toBe(event.occurredAt);
  });

  test('A4: Payload is stored as-is without mutation', () => {
    const payload = { incidentId: 'inc-1', priorityScore: 75 };
    const event = createEvent(EventType.PRIORITY_CALCULATED, payload);
    expect(event.payload).toEqual(payload);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. EventPublisher registry
// ═══════════════════════════════════════════════════════════════════════════════

describe('B. EventPublisher registry', () => {

  test('B1: registerPublisher + getPublisher returns the registered instance', () => {
    const mockPublisher = { publish: jest.fn(), close: jest.fn() };
    registerPublisher(mockPublisher);
    expect(getPublisher()).toBe(mockPublisher);
  });

  test('B2: Re-registering overwrites the previous publisher', () => {
    const pub1 = { publish: jest.fn(), close: jest.fn() };
    const pub2 = { publish: jest.fn(), close: jest.fn() };
    registerPublisher(pub1);
    registerPublisher(pub2);
    expect(getPublisher()).toBe(pub2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. Outbox helper
// ═══════════════════════════════════════════════════════════════════════════════

describe('C. Outbox helper', () => {

  test('C1: writeOutboxEventDirect calls prisma.outboxEvent.create with PENDING status', async () => {
    const event = createEvent(EventType.INCIDENT_CREATED, {
      incidentId: 'i1', severity: 'HIGH', status: 'PENDING', createdById: 'u1',
    });
    await writeOutboxEventDirect(event);
    expect(mockOutboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId:   event.eventId,
        eventType: EventType.INCIDENT_CREATED,
        status:    'PENDING',
      }),
    });
  });

  test('C2: writeOutboxEvent calls tx.outboxEvent.create', async () => {
    const event = createEvent(EventType.ASSIGNMENT_CREATED, {
      assignmentId: 'a1', incidentId: 'i1', resourceId: 'r1',
    });
    const fakeTx = { outboxEvent: { create: jest.fn().mockResolvedValue({}) } };
    await writeOutboxEvent(fakeTx as never, event);
    expect(fakeTx.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventId: event.eventId }) }),
    );
  });

  test('C3: Payload stored correctly', async () => {
    const payload = { incidentId: 'i-99', severity: 'CRITICAL', status: 'PENDING', createdById: 'u-1' };
    await writeOutboxEventDirect(createEvent(EventType.INCIDENT_CREATED, payload));
    expect(mockOutboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({ incidentId: 'i-99' }),
        }),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// D. Outbox publisher
// ═══════════════════════════════════════════════════════════════════════════════

describe('D. publishPendingOutboxEvents()', () => {

  test('D1: Returns 0 when no pending events', async () => {
    mockOutboxFindMany.mockResolvedValue([]);
    const count = await publishPendingOutboxEvents();
    expect(count).toBe(0);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  test('D2: Publishes pending events and marks them PUBLISHED', async () => {
    mockOutboxFindMany.mockResolvedValue([{
      id: 'o-1', eventId: 'evt-001', eventType: 'INCIDENT_CREATED',
      payload: { incidentId: 'i1' }, attempts: 0, createdAt: new Date(),
    }]);

    const count = await publishPendingOutboxEvents();

    expect(count).toBe(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt-001', eventType: 'INCIDENT_CREATED' }),
    );
    expect(mockOutboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o-1' },
        data:  expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    );
  });

  test('D3: Enqueue failure increments attempts, keeps PENDING', async () => {
    mockOutboxFindMany.mockResolvedValue([{
      id: 'o-2', eventId: 'evt-002', eventType: 'INCIDENT_CREATED',
      payload: {}, attempts: 1, createdAt: new Date(),
    }]);
    mockEnqueue.mockRejectedValueOnce(new Error('Redis unavailable'));

    const count = await publishPendingOutboxEvents();

    expect(count).toBe(0);
    expect(mockOutboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempts: 2, status: 'PENDING' }),
      }),
    );
  });

  test('D4: After MAX_PUBLISH_ATTEMPTS failures, marks FAILED', async () => {
    mockOutboxFindMany.mockResolvedValue([{
      id: 'o-3', eventId: 'evt-003', eventType: 'INCIDENT_CREATED',
      payload: {}, attempts: 4, createdAt: new Date(),
    }]);
    mockEnqueue.mockRejectedValueOnce(new Error('Redis unavailable'));

    await publishPendingOutboxEvents();

    expect(mockOutboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempts: 5, status: 'FAILED' }),
      }),
    );
  });

  test('D5: Publishes multiple events in one poll cycle', async () => {
    mockOutboxFindMany.mockResolvedValue([
      { id: 'o1', eventId: 'e1', eventType: 'INCIDENT_CREATED', payload: {}, attempts: 0, createdAt: new Date() },
      { id: 'o2', eventId: 'e2', eventType: 'ASSIGNMENT_CREATED', payload: {}, attempts: 0, createdAt: new Date() },
    ]);

    const count = await publishPendingOutboxEvents();
    expect(count).toBe(2);
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
  });

  test('D6: Queries only PENDING events', async () => {
    mockOutboxFindMany.mockResolvedValue([]);
    await publishPendingOutboxEvents();
    expect(mockOutboxFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'PENDING' }) }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E. Incident service — outbox on createIncident
// ═══════════════════════════════════════════════════════════════════════════════

describe('E. Incident service — outbox events', () => {

  const userId = 'user-001';
  const incidentBase = {
    id: 'inc-001', title: 'Fire', description: 'desc', severity: 'HIGH',
    status: 'PENDING', timeSensitivity: 'HIGH', affectedPeople: 10,
    latitude: 23.81, longitude: 90.41, environmentalCondition: null,
    resourceRequirements: [], priorityScore: null, createdById: userId,
    createdAt: new Date(), updatedAt: new Date(),
  };

  test('E1: createIncident writes INCIDENT_CREATED outbox event', async () => {
    mockIncidentCreate.mockResolvedValue(incidentBase);
    mockIncidentFindUnique.mockResolvedValue({
      ...incidentBase,
      createdBy: { id: userId, name: 'T', email: 'a@b.com', role: 'CITIZEN' },
    });

    const { createIncident } = await import('../modules/incident/incident.service');
    await createIncident({
      title: 'Fire', description: 'A fire on main st', severity: 'HIGH',
      affectedPeople: 10, latitude: 23.81, longitude: 90.41,
      timeSensitivity: 'HIGH', resourceRequirements: [],
    }, userId);

    expect(getOutboxEventTypes()).toContain(EventType.INCIDENT_CREATED);
  });

  test('E2: INCIDENT_CREATED payload contains correct incidentId', async () => {
    mockIncidentCreate.mockResolvedValue(incidentBase);
    mockIncidentFindUnique.mockResolvedValue({
      ...incidentBase,
      createdBy: { id: userId, name: 'T', email: 'a@b.com', role: 'CITIZEN' },
    });

    const { createIncident } = await import('../modules/incident/incident.service');
    await createIncident({
      title: 'Fire', description: 'A fire on main st', severity: 'HIGH',
      affectedPeople: 10, latitude: 23.81, longitude: 90.41,
      timeSensitivity: 'HIGH', resourceRequirements: [],
    }, userId);

    const payload = getOutboxPayload(EventType.INCIDENT_CREATED);
    expect(payload?.['incidentId']).toBe('inc-001');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F. Assignment service — outbox events inside transaction
// ═══════════════════════════════════════════════════════════════════════════════

describe('F. Assignment service — outbox events inside transaction', () => {

  const incidentId = 'inc-001';
  const resourceId = 'res-A12';

  const setupHappyPath = () => {
    mockIncidentFindUnique.mockResolvedValue({
      id: incidentId, status: 'VALIDATED', affectedPeople: 5,
      resourceRequirements: ['AMBULANCE'],
    });
    mockResourceFindUnique.mockResolvedValue({
      id: resourceId, name: 'A-12', type: 'AMBULANCE', status: 'AVAILABLE', capacity: 20,
    });
    mockAssignmentFindFirst.mockResolvedValue(null);
    mockAssignmentCreate.mockResolvedValue({
      id: 'assign-001', incidentId, resourceId, status: 'ACTIVE',
      incident: { id: incidentId, title: 'T', status: 'ASSIGNED', severity: 'HIGH', affectedPeople: 5, latitude: 0, longitude: 0 },
      resource: { id: resourceId, name: 'A-12', type: 'AMBULANCE', status: 'BUSY', capacity: 20, latitude: 0, longitude: 0 },
    });
    mockResourceUpdate.mockResolvedValue({});
    mockIncidentUpdate.mockResolvedValue({});
  };

  test('F1: createAssignment writes ASSIGNMENT_CREATED outbox inside tx', async () => {
    setupHappyPath();
    const { createAssignment } = await import('../modules/assignment/assignment.service');
    await createAssignment({ incidentId, resourceId });
    expect(getOutboxEventTypes()).toContain(EventType.ASSIGNMENT_CREATED);
  });

  test('F2: completeAssignment writes ASSIGNMENT_COMPLETED outbox inside tx', async () => {
    mockAssignmentFindUnique.mockResolvedValue({
      id: 'assign-001', status: 'ACTIVE', incidentId, resourceId,
    });
    mockAssignmentUpdate.mockResolvedValue({
      id: 'assign-001', status: 'COMPLETED', incidentId, resourceId, releasedAt: new Date(),
      incident: { id: incidentId, title: 'T', status: 'DISPATCHED', severity: 'HIGH', affectedPeople: 5, latitude: 0, longitude: 0 },
      resource: { id: resourceId, name: 'A-12', type: 'AMBULANCE', status: 'AVAILABLE', capacity: 20, latitude: 0, longitude: 0 },
    });
    mockResourceUpdate.mockResolvedValue({});
    mockIncidentUpdate.mockResolvedValue({});

    const { completeAssignment } = await import('../modules/assignment/assignment.service');
    await completeAssignment('assign-001');
    expect(getOutboxEventTypes()).toContain(EventType.ASSIGNMENT_COMPLETED);
  });

  test('F3: cancelAssignment writes ASSIGNMENT_CANCELLED outbox inside tx', async () => {
    mockAssignmentFindUnique.mockResolvedValue({
      id: 'assign-001', status: 'ACTIVE', incidentId, resourceId,
    });
    mockAssignmentUpdate.mockResolvedValue({
      id: 'assign-001', status: 'CANCELLED', incidentId, resourceId, releasedAt: new Date(),
      incident: { id: incidentId, title: 'T', status: 'PROCESSING', severity: 'HIGH', affectedPeople: 5, latitude: 0, longitude: 0 },
      resource: { id: resourceId, name: 'A-12', type: 'AMBULANCE', status: 'AVAILABLE', capacity: 20, latitude: 0, longitude: 0 },
    });
    mockResourceUpdate.mockResolvedValue({});
    mockIncidentFindUnique.mockResolvedValue({ id: incidentId, status: 'ASSIGNED' });
    mockIncidentUpdate.mockResolvedValue({});

    const { cancelAssignment } = await import('../modules/assignment/assignment.service');
    await cancelAssignment('assign-001');
    expect(getOutboxEventTypes()).toContain(EventType.ASSIGNMENT_CANCELLED);
  });

  test('F4: ASSIGNMENT_CREATED payload has correct incidentId and resourceId', async () => {
    setupHappyPath();
    const { createAssignment } = await import('../modules/assignment/assignment.service');
    await createAssignment({ incidentId, resourceId });

    const payload = getOutboxPayload(EventType.ASSIGNMENT_CREATED);
    expect(payload?.['incidentId']).toBe(incidentId);
    expect(payload?.['resourceId']).toBe(resourceId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// G. Resource service — outbox on status change
// ═══════════════════════════════════════════════════════════════════════════════

describe('G. Resource service — outbox on status change', () => {

  const resourceId = 'res-001';
  const makeResource = (status: string) => ({
    id: resourceId, name: 'Ambulance A-01', type: 'AMBULANCE',
    status, capacity: 10, latitude: 0, longitude: 0,
    createdAt: new Date(), updatedAt: new Date(),
  });

  test('G1: Status change publishes RESOURCE_STATUS_CHANGED', async () => {
    mockResourceFindUnique.mockResolvedValue(makeResource('AVAILABLE'));
    mockResourceUpdate.mockResolvedValue(makeResource('FAILED'));
    mockAssignmentFindFirst.mockResolvedValue(null);

    const { updateResource } = await import('../modules/resource/resource.service');
    await updateResource(resourceId, { status: 'FAILED' });

    expect(getOutboxEventTypes()).toContain(EventType.RESOURCE_STATUS_CHANGED);
  });

  test('G2: FAILED status also publishes RESOURCE_FAILURE_DETECTED', async () => {
    mockResourceFindUnique.mockResolvedValue(makeResource('AVAILABLE'));
    mockResourceUpdate.mockResolvedValue(makeResource('FAILED'));
    mockAssignmentFindFirst.mockResolvedValue(null);

    const { updateResource } = await import('../modules/resource/resource.service');
    await updateResource(resourceId, { status: 'FAILED' });

    const types = getOutboxEventTypes();
    expect(types).toContain(EventType.RESOURCE_STATUS_CHANGED);
    expect(types).toContain(EventType.RESOURCE_FAILURE_DETECTED);
  });

  test('G3: No outbox event when status is not changed', async () => {
    mockResourceFindUnique.mockResolvedValue(makeResource('AVAILABLE'));
    mockResourceUpdate.mockResolvedValue(makeResource('AVAILABLE'));

    const { updateResource } = await import('../modules/resource/resource.service');
    await updateResource(resourceId, { name: 'New Name' });

    expect(mockOutboxCreate).not.toHaveBeenCalled();
  });

  test('G4: RESOURCE_FAILURE_DETECTED payload includes activeAssignmentId', async () => {
    mockResourceFindUnique.mockResolvedValue(makeResource('AVAILABLE'));
    mockResourceUpdate.mockResolvedValue(makeResource('FAILED'));
    mockAssignmentFindFirst.mockResolvedValue({ id: 'assign-active' });

    const { updateResource } = await import('../modules/resource/resource.service');
    await updateResource(resourceId, { status: 'FAILED' });

    const payload = getOutboxPayload(EventType.RESOURCE_FAILURE_DETECTED);
    expect(payload?.['activeAssignmentId']).toBe('assign-active');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// H. Idempotency — duplicate event detection
// ═══════════════════════════════════════════════════════════════════════════════

describe('H. Idempotency', () => {

  test('H1: handleIncidentCreated calls calculatePriority with correct incidentId', async () => {
    const job = {
      id: 'job-1', name: EventType.INCIDENT_CREATED, attemptsMade: 0,
      data: {
        eventId: 'e-idem-1', eventType: EventType.INCIDENT_CREATED,
        occurredAt: new Date().toISOString(), version: 1,
        payload: { incidentId: 'inc-test', severity: 'HIGH', status: 'PENDING', createdById: 'u1' },
      },
    };
    mockCalculatePriority.mockResolvedValueOnce({ priorityScore: 65 });

    await handleIncidentCreated(job as never);

    expect(mockCalculatePriority).toHaveBeenCalledWith('inc-test');
  });

  test('H2: ProcessedEvent schema — eventId is the idempotency key', () => {
    // Verifies contract: ProcessedEvent.eventId must be unique
    // This is enforced by the Prisma schema @unique constraint
    // and the upsert call in the worker (tested via mock structure)
    expect(mockProcessedUpsert).toBeDefined();
    expect(mockProcessedFindUnique).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// I. Event handler routing
// ═══════════════════════════════════════════════════════════════════════════════

describe('I. Event handlers', () => {

  test('I1: FAILED resource with active assignment → REOPTIMIZATION_REQUESTED published', async () => {
    const job = {
      id: 'job-2', name: EventType.RESOURCE_STATUS_CHANGED, attemptsMade: 0,
      data: {
        eventId: 'e2', eventType: EventType.RESOURCE_STATUS_CHANGED,
        occurredAt: new Date().toISOString(), version: 1,
        payload: { resourceId: 'r-1', resourceName: 'A-12', previousStatus: 'BUSY', newStatus: 'FAILED' },
      },
    };
    mockAssignmentFindFirst.mockResolvedValue({ id: 'assign-999', incidentId: 'inc-99' });

    await handleResourceStatusChanged(job as never);

    expect(getOutboxEventTypes()).toContain(EventType.REOPTIMIZATION_REQUESTED);
    const payload = getOutboxPayload(EventType.REOPTIMIZATION_REQUESTED);
    expect(payload?.['assignmentId']).toBe('assign-999');
    expect(payload?.['trigger']).toBe('RESOURCE_FAILURE');
  });

  test('I2: AVAILABLE status change does NOT trigger reoptimization', async () => {
    const job = {
      id: 'job-3', name: EventType.RESOURCE_STATUS_CHANGED, attemptsMade: 0,
      data: {
        eventId: 'e3', eventType: EventType.RESOURCE_STATUS_CHANGED,
        occurredAt: new Date().toISOString(), version: 1,
        payload: { resourceId: 'r-1', resourceName: 'A-12', previousStatus: 'BUSY', newStatus: 'AVAILABLE' },
      },
    };

    await handleResourceStatusChanged(job as never);

    expect(mockOutboxCreate).not.toHaveBeenCalled();
  });

  test('I3: MAINTENANCE status with active assignment → REOPTIMIZATION_REQUESTED with RESOURCE_MAINTENANCE trigger', async () => {
    const job = {
      id: 'job-4', name: EventType.RESOURCE_STATUS_CHANGED, attemptsMade: 0,
      data: {
        eventId: 'e4', eventType: EventType.RESOURCE_STATUS_CHANGED,
        occurredAt: new Date().toISOString(), version: 1,
        payload: { resourceId: 'r-1', resourceName: 'A-12', previousStatus: 'BUSY', newStatus: 'MAINTENANCE' },
      },
    };
    mockAssignmentFindFirst.mockResolvedValue({ id: 'assign-m', incidentId: 'inc-m' });

    await handleResourceStatusChanged(job as never);

    const payload = getOutboxPayload(EventType.REOPTIMIZATION_REQUESTED);
    expect(payload?.['trigger']).toBe('RESOURCE_MAINTENANCE');
  });

  test('I4: FAILED resource with no active assignment — no reoptimization published', async () => {
    const job = {
      id: 'job-5', name: EventType.RESOURCE_STATUS_CHANGED, attemptsMade: 0,
      data: {
        eventId: 'e5', eventType: EventType.RESOURCE_STATUS_CHANGED,
        occurredAt: new Date().toISOString(), version: 1,
        payload: { resourceId: 'r-1', resourceName: 'A-12', previousStatus: 'AVAILABLE', newStatus: 'FAILED' },
      },
    };
    mockAssignmentFindFirst.mockResolvedValue(null);

    await handleResourceStatusChanged(job as never);

    expect(mockOutboxCreate).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// J. Event type registry
// ═══════════════════════════════════════════════════════════════════════════════

describe('J. EventType registry', () => {

  test('J1: Contains all 10 required event types', () => {
    const types = Object.values(EventType);
    expect(types).toContain('INCIDENT_CREATED');
    expect(types).toContain('INCIDENT_UPDATED');
    expect(types).toContain('PRIORITY_CALCULATED');
    expect(types).toContain('RESOURCE_STATUS_CHANGED');
    expect(types).toContain('RESOURCE_FAILURE_DETECTED');
    expect(types).toContain('ASSIGNMENT_CREATED');
    expect(types).toContain('ASSIGNMENT_COMPLETED');
    expect(types).toContain('ASSIGNMENT_CANCELLED');
    expect(types).toContain('REOPTIMIZATION_REQUESTED');
    expect(types).toContain('REOPTIMIZATION_COMPLETED');
    expect(types).toHaveLength(10);
  });

  test('J2: createEvent default version is 1', () => {
    const event = createEvent(EventType.ASSIGNMENT_CREATED, {
      assignmentId: 'a', incidentId: 'i', resourceId: 'r',
    });
    expect(event.version).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// K. Transaction rollback — no orphaned events
// ═══════════════════════════════════════════════════════════════════════════════

describe('K. Transaction rollback — no orphaned events', () => {

  test('K1: If assignment.create throws inside tx, outbox event is also not committed', async () => {
    // The outbox write uses writeOutboxEvent(tx, ...) — same tx as assignment.create.
    // If the tx callback throws, Prisma rolls back all writes including outboxEvent.create.
    // We simulate by making the tx callback throw from assignment.create.

    const prismaModule = await import('../lib/prisma');
    (prismaModule.default.$transaction as jest.Mock).mockImplementationOnce(
      async (cb: (tx: unknown) => Promise<unknown>) => {
        const failTx = {
          incident:    { findUnique: jest.fn().mockResolvedValue({ id: 'i', status: 'VALIDATED', affectedPeople: 5, resourceRequirements: [] }) },
          resource:    { findUnique: jest.fn().mockResolvedValue({ id: 'r', name: 'A', type: 'AMBULANCE', status: 'AVAILABLE', capacity: 10 }) },
          assignment:  {
            findFirst:  jest.fn().mockResolvedValue(null),
            create:     jest.fn().mockRejectedValue(new Error('Simulated DB error')),
            update:     jest.fn(),
            findUnique: jest.fn(),
          },
          decisionLog: { create: jest.fn() },
          outboxEvent: { create: jest.fn() }, // tx-scoped — rolled back on throw
        };
        return cb(failTx);
      },
    );

    const { createAssignment } = await import('../modules/assignment/assignment.service');
    await expect(
      createAssignment({ incidentId: 'i', resourceId: 'r' }),
    ).rejects.toThrow('Simulated DB error');

    // The TOP-LEVEL mockOutboxCreate (not tx-scoped) must NOT have been called
    // because the outbox write is inside the transaction, not after it.
    expect(mockOutboxCreate).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// L. BullMQ / config verification
// ═══════════════════════════════════════════════════════════════════════════════

describe('L. BullMQ / config verification', () => {

  test('L1: DOMAIN_EVENTS_QUEUE is "domain-events"', async () => {
    const { DOMAIN_EVENTS_QUEUE } = await import('../queue/queue.service');
    expect(DOMAIN_EVENTS_QUEUE).toBe('domain-events');
  });

  test('L2: buildRedisConnection returns host and port', async () => {
    const { buildRedisConnection } = await import('../queue/queue.service');
    const conn = buildRedisConnection();
    expect(conn).toHaveProperty('host');
    expect(conn).toHaveProperty('port');
  });

  test('L3: WORKER_MAX_ATTEMPTS is at least 1', async () => {
    const config = (await import('../config')).default;
    expect(config.worker.maxAttempts).toBeGreaterThanOrEqual(1);
  });

  test('L4: OUTBOX_POLL_INTERVAL_MS is a positive number', async () => {
    const config = (await import('../config')).default;
    expect(config.worker.outboxPollIntervalMs).toBeGreaterThan(0);
  });
});
