-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('PRIORITY_CALCULATION', 'RESOURCE_RECOMMENDATION', 'RESOURCE_ASSIGNMENT', 'RESOURCE_REJECTION');

-- CreateTable
CREATE TABLE "decision_logs" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "selectedResourceId" TEXT,
    "decisionType" "DecisionType" NOT NULL,
    "priorityScore" DOUBLE PRECISION,
    "explanation" JSONB NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "decision_logs_incidentId_idx" ON "decision_logs"("incidentId");

-- CreateIndex
CREATE INDEX "decision_logs_decisionType_idx" ON "decision_logs"("decisionType");

-- AddForeignKey
ALTER TABLE "decision_logs" ADD CONSTRAINT "decision_logs_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_logs" ADD CONSTRAINT "decision_logs_selectedResourceId_fkey" FOREIGN KEY ("selectedResourceId") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
