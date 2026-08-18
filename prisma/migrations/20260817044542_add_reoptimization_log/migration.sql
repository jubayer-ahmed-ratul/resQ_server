-- CreateEnum
CREATE TYPE "ReoptimizationTrigger" AS ENUM ('RESOURCE_FAILURE', 'RESOURCE_UNAVAILABLE', 'RESOURCE_MAINTENANCE', 'ACCESS_CONDITION_CHANGE', 'HIGHER_PRIORITY_INCIDENT', 'CAPACITY_CHANGE');

-- CreateTable
CREATE TABLE "reoptimization_logs" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "trigger" "ReoptimizationTrigger" NOT NULL,
    "previousResourceId" TEXT NOT NULL,
    "newResourceId" TEXT,
    "reason" TEXT NOT NULL,
    "decisionLogId" TEXT,
    "replaced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reoptimization_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reoptimization_logs_incidentId_idx" ON "reoptimization_logs"("incidentId");

-- CreateIndex
CREATE INDEX "reoptimization_logs_assignmentId_idx" ON "reoptimization_logs"("assignmentId");

-- CreateIndex
CREATE INDEX "reoptimization_logs_trigger_idx" ON "reoptimization_logs"("trigger");

-- AddForeignKey
ALTER TABLE "reoptimization_logs" ADD CONSTRAINT "reoptimization_logs_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reoptimization_logs" ADD CONSTRAINT "reoptimization_logs_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reoptimization_logs" ADD CONSTRAINT "reoptimization_logs_previousResourceId_fkey" FOREIGN KEY ("previousResourceId") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reoptimization_logs" ADD CONSTRAINT "reoptimization_logs_newResourceId_fkey" FOREIGN KEY ("newResourceId") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
