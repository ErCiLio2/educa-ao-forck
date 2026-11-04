-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PENDING', 'PRESENT', 'ABSENT');

-- AlterTable
ALTER TABLE "ClassEnrollment" ALTER COLUMN "attendanceStatus" DROP DEFAULT;
ALTER TABLE "ClassEnrollment" ALTER COLUMN "attendanceStatus" TYPE "AttendanceStatus" USING "attendanceStatus"::"AttendanceStatus";
ALTER TABLE "ClassEnrollment" ALTER COLUMN "attendanceStatus" SET DEFAULT 'PENDING';
ALTER TABLE "ClassEnrollment" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "hoursDebited" DECIMAL(6,2) NOT NULL DEFAULT 0,
ADD COLUMN     "packageId" TEXT;
ALTER TABLE "ClassEnrollment" ALTER COLUMN "hoursDebited" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "ClassSession_scheduledAt_idx" ON "ClassSession"("scheduledAt");
CREATE INDEX "ClassEnrollment_classId_idx" ON "ClassEnrollment"("classId");
CREATE UNIQUE INDEX "ClassEnrollment_classId_studentId_key" ON "ClassEnrollment"("classId", "studentId");

-- AddForeignKey
ALTER TABLE "ClassEnrollment" ADD CONSTRAINT "ClassEnrollment_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "HourPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invariantes ao nível da BD (RN-01: máximo de 7 alunos; saldo de horas nunca negativo)
ALTER TABLE "ClassSession" ADD CONSTRAINT "ClassSession_maxCapacity_check" CHECK ("maxCapacity" BETWEEN 1 AND 7);
ALTER TABLE "HourPackage" ADD CONSTRAINT "HourPackage_remainingHours_check" CHECK ("remainingHours" >= 0);
