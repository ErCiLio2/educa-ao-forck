-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('DATA_PROCESSING');

-- AlterTable
ALTER TABLE "GuardianConsent" ALTER COLUMN "consentType" TYPE "ConsentType" USING "consentType"::"ConsentType";

-- CreateIndex
CREATE INDEX "GuardianConsent_studentId_idx" ON "GuardianConsent"("studentId");

-- CreateIndex
CREATE INDEX "GuardianConsent_guardianId_idx" ON "GuardianConsent"("guardianId");
