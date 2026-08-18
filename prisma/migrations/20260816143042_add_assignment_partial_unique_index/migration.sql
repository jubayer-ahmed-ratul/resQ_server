-- Partial unique index: a resource can only have ONE ACTIVE assignment at a time.
-- This is enforced at the PostgreSQL level, not just application level.
-- Two concurrent transactions trying to insert ACTIVE for the same resourceId
-- will conflict — the second will fail with a unique violation error,
-- which Prisma surfaces as PrismaClientKnownRequestError P2002.
CREATE UNIQUE INDEX "assignments_resourceId_active_unique"
ON "assignments"("resourceId")
WHERE status = 'ACTIVE';

-- Partial unique index: an incident can only have ONE ACTIVE assignment at a time.
CREATE UNIQUE INDEX "assignments_incidentId_active_unique"
ON "assignments"("incidentId")
WHERE status = 'ACTIVE';
