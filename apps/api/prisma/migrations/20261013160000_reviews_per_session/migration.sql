-- As avaliações passam a estar ligadas a uma aula. Nenhum código escrevia Review até agora;
-- se existirem linhas, a migração pára em vez de inventar uma aula para elas.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Review") THEN
    RAISE EXCEPTION 'Existem avaliações sem aula associada: resolva-as antes de migrar';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "classId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Review_classId_idx" ON "Review"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_studentId_classId_key" ON "Review"("studentId", "classId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ClassSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RN-06: avaliações de 1 a 5 em todos os critérios, garantido também na BD
ALTER TABLE "Review" ADD CONSTRAINT "Review_ratings_check" CHECK (
  "rating" BETWEEN 1 AND 5 AND "punctuality" BETWEEN 1 AND 5 AND "subjectMastery" BETWEEN 1 AND 5
  AND "didacticClarity" BETWEEN 1 AND 5 AND "progress" BETWEEN 1 AND 5
);
