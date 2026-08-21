# Requirements Document

## Introduction

This feature implements the Emergency Request Approval Workflow for the Intelligent Emergency Response & Resource Optimization Platform. When a Citizen submits an emergency request, it enters a PENDING state and must be reviewed by a Coordinator before any operational action is taken. The workflow enforces role-based authorization, strict status transition guards, and an audit trail for all approval decisions, ensuring that only reviewed and approved incidents trigger resource assignment and operational response.

## Glossary

- **System**: The Intelligent Emergency Response & Resource Optimization Platform backend API.
- **Citizen**: A registered user with role `CITIZEN` who can submit emergency requests and view only their own request status.
- **Coordinator**: A registered user with role `COORDINATOR` who reviews PENDING requests, approves or rejects them, and initiates resource/hospital assignment for approved requests.
- **Operator**: A registered user with role `OPERATOR` who executes tasks on APPROVED and ASSIGNED incidents that are assigned to their resource, updates resource/hospital status, and marks tasks complete.
- **Admin**: A registered user with role `ADMIN` who has full system management access equivalent to Coordinator for all workflow operations.
- **Incident**: An emergency request record with a lifecycle tracked by `IncidentStatus`.
- **IncidentStatus**: The current lifecycle state of an Incident. Valid values: `PENDING`, `APPROVED`, `REJECTED`, `ASSIGNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`.
- **Status_Transition**: A change of an Incident's `IncidentStatus` from one value to another, subject to the allowed transition map.
- **Assignment**: A record linking an approved Incident to a Resource, created only after the Incident reaches `APPROVED` status.
- **Approval_Action**: The act of a Coordinator or Admin changing a PENDING Incident to APPROVED via `PATCH /api/incidents/:id/approve`.
- **Rejection_Action**: The act of a Coordinator or Admin changing a PENDING Incident to REJECTED via `PATCH /api/incidents/:id/reject`.
- **AuditLog**: A permanent record of every sensitive action (CREATE, APPROVE, REJECT, ASSIGN, etc.) written to the `audit_logs` table.

---

## Requirements

### Requirement 1: Citizen Emergency Request Submission

**User Story:** As a Citizen, I want to submit an emergency request, so that I can report an emergency and have it reviewed before responders are dispatched.

#### Acceptance Criteria

1. WHEN a Citizen submits a POST request to `/api/incidents`, THE System SHALL create an Incident record with `status` set to `PENDING`.
2. WHEN a Citizen submits a POST request to `/api/incidents`, THE System SHALL return the created Incident with `status: "PENDING"` in the response body.
3. WHEN an Admin or Coordinator submits a POST request to `/api/incidents`, THE System SHALL create the Incident with `status` set to `APPROVED` (auto-approved, no Coordinator review required).
4. WHEN an Operator submits a POST request to `/api/incidents`, THE System SHALL create the Incident with `status` set to `APPROVED` (auto-approved).
5. THE System SHALL require authentication for all POST requests to `/api/incidents`.
6. IF an unauthenticated request is made to POST `/api/incidents`, THEN THE System SHALL return HTTP 401.

---

### Requirement 2: Coordinator Review — Approve Incident

**User Story:** As a Coordinator, I want to approve a pending emergency request, so that I can authorize the operational workflow and trigger resource assignment.

#### Acceptance Criteria

1. WHEN a Coordinator sends PATCH `/api/incidents/:id/approve` for a PENDING Incident, THE System SHALL update the Incident `status` to `APPROVED`.
2. WHEN a Coordinator sends PATCH `/api/incidents/:id/approve` for a PENDING Incident, THE System SHALL return HTTP 200 with the updated Incident in the response body.
3. WHEN an Admin sends PATCH `/api/incidents/:id/approve` for a PENDING Incident, THE System SHALL update the Incident `status` to `APPROVED`.
4. IF a Coordinator or Admin sends PATCH `/api/incidents/:id/approve` for an Incident whose `status` is NOT `PENDING`, THEN THE System SHALL return HTTP 400 with a descriptive error message.
5. IF a Citizen or Operator sends PATCH `/api/incidents/:id/approve`, THEN THE System SHALL return HTTP 403.
6. WHEN a Coordinator approves an Incident, THE System SHALL write an AuditLog record with `action: "APPROVE"`, `entity: "INCIDENT"`, and the Incident ID.

---

### Requirement 3: Coordinator Review — Reject Incident

**User Story:** As a Coordinator, I want to reject an inappropriate or invalid emergency request, so that resources are not dispatched for unqualified incidents.

#### Acceptance Criteria

1. WHEN a Coordinator sends PATCH `/api/incidents/:id/reject` for a PENDING Incident, THE System SHALL update the Incident `status` to `REJECTED`.
2. WHEN a Coordinator sends PATCH `/api/incidents/:id/reject` for a PENDING Incident, THE System SHALL return HTTP 200 with the updated Incident in the response body.
3. WHEN an Admin sends PATCH `/api/incidents/:id/reject` for a PENDING Incident, THE System SHALL update the Incident `status` to `REJECTED`.
4. IF a Coordinator or Admin sends PATCH `/api/incidents/:id/reject` for an Incident whose `status` is NOT `PENDING`, THEN THE System SHALL return HTTP 400 with a descriptive error message.
5. IF a Citizen or Operator sends PATCH `/api/incidents/:id/reject`, THEN THE System SHALL return HTTP 403.
6. WHERE a `reason` string is provided in the request body of PATCH `/api/incidents/:id/reject`, THE System SHALL persist the rejection reason on the Incident record.
7. WHEN a Coordinator or Admin rejects an Incident, THE System SHALL write an AuditLog record with `action: "REJECT"`, `entity: "INCIDENT"`, and the Incident ID.

---

### Requirement 4: Valid Status Transition Enforcement

**User Story:** As a system administrator, I want all incident status transitions to be validated by the backend, so that the workflow cannot be bypassed or corrupted by invalid state changes.

#### Acceptance Criteria

1. THE System SHALL enforce the following and only the following forward transitions:
   - `PENDING` → `APPROVED`
   - `PENDING` → `REJECTED`
   - `PENDING` → `CANCELLED`
   - `APPROVED` → `ASSIGNED`
   - `APPROVED` → `CANCELLED`
   - `ASSIGNED` → `IN_PROGRESS`
   - `ASSIGNED` → `CANCELLED`
   - `IN_PROGRESS` → `COMPLETED`
   - `IN_PROGRESS` → `CANCELLED`
2. IF any request attempts a Status_Transition not listed in criterion 1, THEN THE System SHALL return HTTP 400 with an error message identifying the current status, the attempted status, and the list of allowed transitions.
3. THE System SHALL apply Status_Transition validation for the `/approve`, `/reject`, `/cancel`, and `/status` endpoints.
4. WHILE an Incident has `status: "REJECTED"`, THE System SHALL reject all further status transition attempts with HTTP 400.
5. WHILE an Incident has `status: "COMPLETED"` or `status: "CANCELLED"`, THE System SHALL reject all further status transition attempts with HTTP 400.
6. FOR ALL valid status transitions, applying the same transition a second time SHALL be rejected by the System with HTTP 400 (idempotency by rejection for terminal transitions).

---

### Requirement 5: Pre-Assignment Approval Gate

**User Story:** As a Coordinator, I want resource assignment to be blocked until I have approved an incident, so that responders are never dispatched for unreviewed requests.

#### Acceptance Criteria

1. IF an Assignment creation request targets an Incident with `status: "PENDING"`, THEN THE System SHALL return HTTP 409 with an error stating the Incident must be `APPROVED` before assignment.
2. IF an Assignment creation request targets an Incident with `status: "REJECTED"`, THEN THE System SHALL return HTTP 409 with an error stating the Incident has been rejected and cannot be assigned.
3. IF an Assignment creation request targets an Incident with `status: "CANCELLED"`, THEN THE System SHALL return HTTP 409.
4. WHEN a Coordinator sends POST `/api/assignments` for an Incident with `status: "APPROVED"`, THE System SHALL allow the assignment to proceed (subject to resource availability checks).
5. THE System SHALL treat `APPROVED` as the only eligible status for new Assignment creation.

---

### Requirement 6: Operator Access Restriction on PENDING Incidents

**User Story:** As a system enforcer, I want Operators to be prevented from acting on PENDING incidents, so that no operational task is executed before a Coordinator has reviewed the request.

#### Acceptance Criteria

1. IF an Operator sends any write request targeting an Incident with `status: "PENDING"`, THEN THE System SHALL return HTTP 403 or HTTP 409 as appropriate, never allowing the operation to proceed.
2. IF an Operator attempts to create an Assignment for a PENDING Incident, THEN THE System SHALL return HTTP 409.
3. WHILE an Incident has `status: "PENDING"`, THE System SHALL deny any resource status updates that would be caused by assignment of that Incident.
4. WHEN an Operator sends GET `/api/incidents` or GET `/api/incidents/:id`, THE System SHALL return only Incidents that have an active Assignment linked to the Operator's resource (no PENDING Incidents visible to Operators via the list endpoint unless assigned).

---

### Requirement 7: Citizen Request Visibility

**User Story:** As a Citizen, I want to view the status of only my own emergency requests, so that I can track my report without seeing other Citizens' private data.

#### Acceptance Criteria

1. WHEN a Citizen sends GET `/api/incidents`, THE System SHALL return only Incidents where `createdById` equals the authenticated Citizen's user ID.
2. WHEN a Citizen sends GET `/api/incidents/:id` for an Incident not created by that Citizen, THE System SHALL return HTTP 403.
3. WHEN a Citizen sends GET `/api/incidents/:id` for their own Incident, THE System SHALL return HTTP 200 with the full Incident record including current `status`.
4. WHEN a Citizen sends GET `/api/incidents/:id/assignments` for their own Incident, THE System SHALL return HTTP 200 with all assignments for that Incident.
5. IF a Citizen attempts to modify another Citizen's Incident via PATCH `/api/incidents/:id`, THEN THE System SHALL return HTTP 403.
6. IF a Citizen attempts to modify their own Incident that is no longer `PENDING`, THEN THE System SHALL return HTTP 403 with a message indicating only PENDING incidents can be edited.

---

### Requirement 8: Post-Approval Resource and Hospital Assignment

**User Story:** As a Coordinator, I want to assign resources and hospitals to an approved incident, so that I can coordinate the operational response once I've confirmed the incident is valid.

#### Acceptance Criteria

1. WHEN a Coordinator sends POST `/api/assignments` for an `APPROVED` Incident, THE System SHALL create an Assignment record and transition the Incident `status` to `ASSIGNED`.
2. WHEN an Assignment is created for an `APPROVED` Incident, THE System SHALL update the assigned Resource `status` from `AVAILABLE` to `BUSY`.
3. WHEN a Coordinator sends POST `/api/assignments` for an Incident with any status other than `APPROVED`, THE System SHALL return HTTP 409.
4. WHEN an Assignment is successfully created, THE System SHALL write an AuditLog record with `action: "ASSIGN"`, `entity: "INCIDENT"`, and the Incident ID.
5. THE System SHALL support assignment creation only for Resources with `status: "AVAILABLE"`.
6. IF a Coordinator attempts to create an Assignment for a `REJECTED` Incident, THEN THE System SHALL return HTTP 409.

---

### Requirement 9: Operator Task Execution and Completion

**User Story:** As an Operator, I want to execute assigned tasks and update their completion status, so that the system accurately reflects real-world emergency response progress.

#### Acceptance Criteria

1. WHEN an Operator sends PATCH `/api/assignments/:id/complete` for an Assignment linked to their assigned Resource, THE System SHALL update the Assignment `status` to `COMPLETED`.
2. WHEN an Assignment is marked `COMPLETED`, THE System SHALL transition the Incident `status` to `IN_PROGRESS`.
3. WHEN an Assignment is marked `COMPLETED`, THE System SHALL update the Resource `status` from `BUSY` to `AVAILABLE`.
4. IF an Operator attempts to complete an Assignment that is not linked to the Operator's assigned Resource, THEN THE System SHALL return HTTP 403.
5. THE System SHALL prevent Operators from completing Assignments for PENDING or REJECTED Incidents.
6. WHEN an Operator successfully completes an Assignment, THE System SHALL write an AuditLog record with `action: "COMPLETE"`, `entity: "ASSIGNMENT"`, and the Assignment ID.

---

### Requirement 10: Audit Trail for All Approval Decisions

**User Story:** As an Admin, I want a complete audit trail of all approval and rejection decisions, so that I can monitor the system and review all Coordinator actions.

#### Acceptance Criteria

1. WHEN any Incident is created, THE System SHALL write an AuditLog record with `action: "CREATE"`, `entity: "INCIDENT"`, and the actor's user ID.
2. WHEN any Incident is approved, THE System SHALL write an AuditLog record with `action: "APPROVE"`, `entity: "INCIDENT"`, the Incident ID, and the approving Coordinator's user ID.
3. WHEN any Incident is rejected, THE System SHALL write an AuditLog record with `action: "REJECT"`, `entity: "INCIDENT"`, the Incident ID, and the rejecting Coordinator's user ID.
4. WHEN any Assignment is created, THE System SHALL write an AuditLog record with `action: "ASSIGN"`, `entity: "INCIDENT"`, the Incident ID, and the assigning Coordinator's user ID.
5. THE System SHALL store the actor's IP address and user-agent string on each AuditLog record where available.
6. THE System SHALL make AuditLog records available to Admin and Coordinator roles via GET `/api/audit-logs`.
7. THE System SHALL NOT allow AuditLog records to be deleted or modified by any user role.
