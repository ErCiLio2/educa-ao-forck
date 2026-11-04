ALTER TABLE "TutorProfile" ADD COLUMN "levels" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "TutorProfile" ADD COLUMN "avatarKey" TEXT;
ALTER TABLE "TutorProfile" ADD COLUMN "hourlyRate" DECIMAL(12,2);
