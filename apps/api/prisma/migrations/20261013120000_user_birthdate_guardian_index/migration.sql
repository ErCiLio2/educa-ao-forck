-- AlterTable
ALTER TABLE "User" ADD COLUMN     "birthDate" DATE;

-- CreateIndex
CREATE INDEX "User_guardianId_idx" ON "User"("guardianId");
