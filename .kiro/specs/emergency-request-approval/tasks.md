# Implementation Tasks

## Emergency Request Approval Workflow

- [ ] 1. Add `rejectionReason` column to the Incident schema and run migration
  - Add `rejectionReason String?` field to the `Incident` model in `prisma/schema.prisma`
  - Generate and apply a new Prisma migration: `npx prisma migrate dev --name add_rejection_reason`
  - Verify the column appears in the generated Prisma client types
  - **Files:** `prisma/schema.prisma`, new migration file
  - **Requirement:** R3 (rejection reason persistence)

- [ ] 2. Fix `createIncident` to auto-approve COORDINATOR-created incidents
  - In `incident.service.ts → createIncident`, change the auto-approve condition to include `COORDINATOR`:
    ```ts
    const AUTO_APPROVE_ROLES = ['OPERATOR', 'ADMIN', 'COORDINATOR'];
    const initialStatus = AUTO_APPROVE_ROLES.includes(userRole) ? 'APPROVED' : 'PENDING';
    ```
  - **Files:** `src/modules/incident/incident.service.ts`
  - **Requirement:** R1 (only CITIZEN-created incidents start as PENDING)

- [ ] 3. Fix `approveIncident` to remove the creator-role guard
  - In `incident.service.ts → approveIncident`, remove the block that throws when `incident.createdBy.role !== 'CITIZEN'`
  - Remove the `include: { createdBy: { select: { role: true } } }` from the `findUnique` call since it is no longer needed
  - The `status !== 'PENDING'` check is sufficient — keep it
  - **Files:** `src/modules/incident/incident.service.ts`
  - **Requirement:** R2 (Coordinator/Admin can approve any PENDING incident)

- [ ] 4. Fix `rejectIncident` to write `rejectionReason` instead of overwriting `environmentalCondition`
  - In `incident.service.ts → rejectIncident`, change the Prisma update to:
    ```ts
    data: {
      status: 'REJECTED',
      ...(reason !== undefined && { rejectionReason: reason }),
    },
    ```
  - Remove the old `environmentalCondition: \`REJECTED: ${reason}\`` hack
  - **Files:** `src/modules/incident/incident.service.ts`
  - **Requirement:** R3 (rejection reason stored in dedicated field)

- [ ] 5. Add Zod validation for the reject endpoint request body
  - In `incident.route.ts`, define a `rejectIncidentSchema`:
    ```ts
    const rejectIncidentSchema = z.object({
      reason: z
        .string()
        .max(500, 'Rejection reason must not exceed 500 characters.')
        .trim()
        .optional(),
    });
    ```
  - Apply `validate(rejectIncidentSchema)` middleware on the `PATCH /:id/reject` route before the controller
  - **Files:** `src/modules/incident/incident.route.ts`
  - **Requirement:** R3 (reason validated to max 500 chars)

- [ ] 6. Block direct `APPROVED → ASSIGNED` transition via the generic status endpoint
  - In `incident.service.ts → updateIncidentStatus`, after the allowed-transitions check, add a guard that throws `HTTP 400` if `nextStatus === 'ASSIGNED'`
  - This ensures `ASSIGNED` status can only be set by the assignment service (which creates a real `Assignment` record), not directly via `PATCH /:id/status`
  - **Files:** `src/modules/incident/incident.service.ts`
  - **Requirement:** R4, R5 (status transitions enforced; assignment gate maintained)

- [ ] 7. Verify end-to-end workflow with manual test cases
  - Test the complete happy path: Citizen creates incident (PENDING) → Coordinator approves (APPROVED) → Coordinator assigns resource (ASSIGNED) → Operator completes (IN_PROGRESS) → mark COMPLETED
  - Test rejection path: Citizen creates incident → Coordinator rejects with reason → confirm `rejectionReason` field is populated → confirm POST /assignments returns 409
  - Test invalid transitions: attempt PENDING → ASSIGNED directly via /status → confirm 400
  - Test role guards: Citizen attempts to hit /approve → confirm 403; Operator attempts to hit /approve → confirm 403
  - **Files:** no code changes — validation only
  - **Requirement:** R1–R10
