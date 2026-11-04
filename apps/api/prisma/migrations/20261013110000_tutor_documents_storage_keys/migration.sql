-- Os documentos passam a ser referenciados por chave de objecto no bucket privado (não por URL).
ALTER TABLE "TutorProfile" RENAME COLUMN "diplomaUrl" TO "diplomaKey";
ALTER TABLE "TutorProfile" RENAME COLUMN "criminalRecordUrl" TO "criminalRecordKey";
ALTER TABLE "TutorProfile" RENAME COLUMN "passportPhotoUrl" TO "passportPhotoKey";
ALTER TABLE "TutorProfile" RENAME COLUMN "videoIntroUrl" TO "videoIntroKey";
