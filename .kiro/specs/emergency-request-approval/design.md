# Design Document

## Emergency Request Approval Workflow

### Overview

This feature formalises the approval gate that sits between a Citizen's emergency submission and any operational response. The core business invariant — **no resource assignment before Coordinator approval** — is already partially implemented in the codebase. This design identifies what exists, what is missing or incomplete, and precisely what needs to change.

The design requires **zero new database tables** and **zero new routes**. All work is additive changes to existing service/controller logic and one Prisma migration to add a dedicated `rejectionReason` column on the `Incident` table.

---

### Architecture

The system follows the existing layered pattern:

```
HTTP Request
    ↓
authenticate (JWT)
    ↓
requireRoles (role gate)
    ↓
[requireIncidentAccess / requireAssignmentAccess] (ownership gate)
    ↓
Controller (HTTP glue, audit log)
    ↓
Service (business logic, Prisma transaction)
    ↓
Database (PostgreSQL via Prisma)
```

No new layers or services are introduced.

---

### What Already Exists (no changes needed)

| Concern | Location | Status |
|---|---|---|
| `PENDING` as default status for CITIZEN-created incidents | `incident.service.ts → createIncident` | ✅ Done |
| Auto-`APPROVED` for ADMIN/OPERATOR-created incidents | `incident.service.ts → createIncident` | ✅ Done |
| `PATCH /:id/approve` route (COORDINATOR/ADMIN only) | `incident.route.ts` | ✅ Done |
| `PATCH /:id/reject` route (COORDINATOR/ADMIN only) | `incident.route.ts` | ✅ Done |
| `approveIncident` service function (PENDING → APPROVED) | `incident.service.ts` | ✅ Done |
| `rejectIncident` service function (PENDING → REJECTED) | `incident.service.ts` | ✅ Done |
| `ALLOWED_STATUS_TRANSITIONS` map | `incident.interface.ts` | ✅ Done |
| `ASSIGNABLE_INCIDENT_STATUSES = ['APPROVED']` guard | `assignment.service.ts` | ✅ Done |
| CITIZEN-scoped `GET /incidents` (own incidents only) | `incident.service.ts → getIncidents` | ✅ Done |
| OPERATOR-scoped `GET /incidents` (assigned only) | `incident.service.ts → getIncidents` | ✅ Done |
| `requireIncidentAccess` ownership middleware | `permissions.ts` | ✅ Done |
| `writeAuditLog` for CREATE/APPROVE/REJECT/CANCEL | `incident.controller.ts` | ✅ Done |
| `writeAuditLog` for ASSIGN/COMPLETE | `assignment.controller.ts` | ✅ Done |
| CITIZEN edit guard (own PENDING only) | `incident.service.ts → updateIncident` | ✅ Done |

---

### What is Incomplete or Missing

#### Gap 1 — `rejectIncident` does not persist rejection reason properly

**Current behaviour:** The rejection reason is stored by overwriting `environmentalCondition` with `"REJECTED: <reason>"`. This is a hack — it corrupts a semantic field.

**Fix:** Add a dedicated `rejectionReason String?` column to the `Incident` model and write to it instead.

**Files affected:**
- `prisma/schema.prisma` — add `rejectionReason String?` field
- new migration: `prisma/migrations/..._add_rejection_reason/migration.sql`
- `incident.service.ts → rejectIncident` — write to `rejectionReason` instead of `environmentalCondition`

#### Gap 2 — `approveIncident` blocks COORDINATOR-created incidents

**Current behaviour:** `approveIncident` checks `incident.createdBy.role !== 'CITIZEN'` and throws if the creator is not a CITIZEN — meaning it **rejects any attempt to approve a COORDINATOR-created incident**, even if it somehow ended up as PENDING.

**Fix:** Remove the creator-role check. The status check (`status !== 'PENDING'`) is sufficient. COORDINATOR-created incidents are given `APPROVED` on creation so this path is never reached in practice, but the hard block is fragile and incorrect.

**Files affected:**
- `incident.service.ts → approveIncident`

#### Gap 3 — `PATCH /:id/reject` has no Zod validation schema for the request body

**Current behaviour:** The reject route has no `validate(...)` middleware — the `reason` field is read from `req.body` without any schema validation or length enforcement.

**Fix:** Add a `rejectIncidentSchema` (Zod, `reason` optional string, max 500 chars) and apply `validate(rejectIncidentSchema)` on the reject route.

**Files affected:**
- `incident.route.ts`

#### Gap 4 — COORDINATOR-created incidents skip the approval workflow

**Current behaviour:** Per `incident.service.ts`, only `OPERATOR` and `ADMIN` get `initialStatus = 'APPROVED'`. COORDINATOR-created incidents get `PENDING` — meaning a Coordinator would have to approve their own request.

The requirements state: _"Coordinator → review PENDING requests → Approve / Reject → Start operational assignment after approval"_. A Coordinator creating an incident directly (e.g. from the field) should not require self-approval.

**Fix:** Include `COORDINATOR` in the auto-approve condition:
```ts
const initialStatus = ['OPERATOR', 'ADMIN', 'COORDINATOR'].includes(userRole) ? 'APPROVED' : 'PENDING';
```

**Files affected:**
- `incident.service.ts → createIncident`

#### Gap 5 — `PATCH /:id/status` allows bypassing the approval gate

**Current behaviour:** `PATCH /:id/status` (COORDINATOR/ADMIN only) calls `updateIncidentStatus`, which uses `ALLOWED_STATUS_TRANSITIONS`. That map does allow `PENDING → APPROVED` and `PENDING → REJECTED`. This is correct and intentional. No change needed.

However, the `ASSIGNED` and `IN_PROGRESS` transitions are also reachable directly from this endpoint — meaning a Coordinator could skip the assignment service and drive `APPROVED → ASSIGNED` without creating an actual `Assignment` record. This leaves the system in an inconsistent state.

**Fix:** In `updateIncidentStatus`, block `APPROVED → ASSIGNED` direct transitions (the ASSIGNED status must only be set by the assignment service, never by the generic status endpoint).

**Files affected:**
- `incident.service.ts → updateIncidentStatus`

---

### Data Model Changes

Only one schema change is required:

```prisma
model Incident {
  // ... existing fields ...

  // Added: dedicated field for coordinator rejection reason
  // Previously this was hackily stored in environmentalCondition
  rejectionReason String?   // <-- NEW

  // ... rest of model ...
}
```

**Migration SQL:**
```sql
ALTER TABLE "incidents" ADD COLUMN "rejectionReason" TEXT;
```

No index is needed on `rejectionReason` — it is never filtered on.

---

### Component Design

#### `incident.service.ts` Changes

**`createIncident`** — change auto-approve condition:
```ts
// Before:
const initialStatus = (userRole === 'OPERATOR' || userRole === 'ADMIN') ? 'APPROVED' : 'PENDING';

// After:
const AUTO_APPROVE_ROLES = ['OPERATOR', 'ADMIN', 'COORDINATOR'];
const initialStatus = AUTO_APPROVE_ROLES.includes(userRole) ? 'APPROVED' : 'PENDING';
```

**`approveIncident`** — remove the creator-role check:
```ts
// Remove this block entirely:
if (incident.createdBy.role !== 'CITIZEN') {
  throw new AppError(
    'This incident was created by an OPERATOR or ADMIN and was auto-approved on creation.',
    httpStatus.BAD_REQUEST,
  );
}
```
The `findUnique` can also drop the `include` since we no longer need `createdBy.role`.

**`rejectIncident`** — write to `rejectionReason` instead of `environmentalCondition`:
```ts
// Before:
data: {
  status: 'REJECTED',
  ...(reason && { environmentalCondition: `REJECTED: ${reason}` }),
},

// After:
data: {
  status: 'REJECTED',
  ...(reason !== undefined && { rejectionReason: reason }),
},
```

**`updateIncidentStatus`** — block direct APPROVED → ASSIGNED transition:
```ts
// Add after the allowed-transitions check:
const ASSIGNMENT_SERVICE_ONLY = new Set<string>(['ASSIGNED']);
if (ASSIGNMENT_SERVICE_ONLY.has(nextStatus)) {
  throw new AppError(
    `Status "${nextStatus}" can only be set by creating an assignment, not via the status endpoint.`,
    httpStatus.BAD_REQUEST,
  );
}
```

#### `incident.route.ts` Changes

Add a `rejectIncidentSchema` and apply it:
```ts
const rejectIncidentSchema = z.object({
  reason: z
    .string()
    .max(500, 'Rejection reason must not exceed 500 characters.')
    .trim()
    .optional(),
});

// On the reject route:
router.patch(
  '/:id/reject',
  authenticate,
  requireRoles('ADMIN', 'COORDINATOR'),
  validate(rejectIncidentSchema),          // <-- ADD THIS
  catchAsync(incidentController.rejectIncident),
);
```

---

### Request / Response Contracts

#### `POST /api/incidents` (Citizen)
- Request body: `{ title, description, severity, affectedPeople, latitude, longitude, timeSensitivity, environmentalCondition?, resourceRequirements[] }`
- Response `201`: `{ success: true, data: { ...incident, status: "PENDING" } }`

#### `PATCH /api/incidents/:id/approve`
- Auth: COORDINATOR or ADMIN
- Request body: empty
- Response `200`: `{ success: true, data: { ...incident, status: "APPROVED" } }`
- Errors: `400` if not PENDING, `403` if wrong role, `404` if not found

#### `PATCH /api/incidents/:id/reject`
- Auth: COORDINATOR or ADMIN
- Request body: `{ reason?: string }` (max 500 chars)
- Response `200`: `{ success: true, data: { ...incident, status: "REJECTED", rejectionReason: "..." } }`
- Errors: `400` if not PENDING, `403` if wrong role, `404` if not found

#### `POST /api/assignments` (post-approval)
- Auth: COORDINATOR or ADMIN
- Request body: `{ incidentId, resourceId }`
- Precondition: incident.status must be `APPROVED`
- Response `201`: assignment record; incident transitions to `ASSIGNED`
- Errors: `409` if incident not `APPROVED`, `409` if resource not `AVAILABLE`

---

### Status Transition Enforcement

The `ALLOWED_STATUS_TRANSITIONS` map in `incident.interface.ts` already defines the full valid state machine. All enforcement flows through:

1. `/approve` → calls `approveIncident` → explicit `status !== 'PENDING'` check → PENDING → APPROVED
2. `/reject` → calls `rejectIncident` → explicit `status !== 'PENDING'` check → PENDING → REJECTED
3. `/status` → calls `updateIncidentStatus` → uses transition map → blocks ASSIGNED as direct target (Gap 5 fix)
4. `POST /assignments` → `ASSIGNABLE_INCIDENT_STATUSES` check → only APPROVED proceeds

**Invalid transitions are blocked at the service layer** (not just the route layer), so internal callers also get the same guards.

---

### Audit Trail

All audit events are already written correctly via `writeAuditLog` in the controllers. The table below confirms coverage for this feature:

| Action | Where written | AuditAction value |
|---|---|---|
| Incident created | `incident.controller.ts → createIncident` | `CREATE` |
| Incident approved | `incident.controller.ts → approveIncident` | `APPROVE` |
| Incident rejected | `incident.controller.ts → rejectIncident` | `REJECT` |
| Assignment created | `assignment.controller.ts → createAssignment` | `ASSIGN` |
| Assignment completed | `assignment.controller.ts → completeAssignment` | `COMPLETE` |
| Incident cancelled | `incident.controller.ts → cancelIncident` | `CANCEL` |

`writeAuditLog` is fire-and-forget (never blocks the main operation). IP address and user-agent are captured on every call via `req.ip` and `req.headers['user-agent']`.

---

### Error Handling

All service errors use `throw new AppError(message, httpStatus.XXX)`. The global error handler in `app.ts` converts these to structured JSON responses:

```json
{
  "success": false,
  "message": "Cannot approve an incident with status \"ASSIGNED\". Only PENDING incidents can be approved.",
  "errorCode": "BAD_REQUEST",
  "requestId": "..."
}
```

No new error handling infrastructure is needed.

---

### Security Considerations

- All endpoints require a valid JWT via `authenticate`.
- Role enforcement via `requireRoles` happens at the route layer before any business logic runs.
- Ownership checks (`requireIncidentAccess`) ensure Citizens cannot read or modify other Citizens' incidents.
- COORDINATOR-created incidents are auto-approved, removing the self-approval anti-pattern.
- No PII is stored in audit log `details` beyond what is already present in the incident record.
