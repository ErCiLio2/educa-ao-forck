-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfaEnabledAt" TIMESTAMP(3),
ADD COLUMN     "mfaSecret" TEXT;

-- CreateTable
CREATE TABLE "MfaRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleChangeRequest" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "fromRole" "Role" NOT NULL,
    "toRole" "Role" NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "ChangeStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MfaRecoveryCode_codeHash_key" ON "MfaRecoveryCode"("codeHash");

-- CreateIndex
CREATE INDEX "MfaRecoveryCode_userId_idx" ON "MfaRecoveryCode"("userId");

-- CreateIndex
CREATE INDEX "RoleChangeRequest_status_createdAt_idx" ON "RoleChangeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RoleChangeRequest_targetId_idx" ON "RoleChangeRequest"("targetId");

-- AddForeignKey
ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT "MfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleChangeRequest" ADD CONSTRAINT "RoleChangeRequest_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleChangeRequest" ADD CONSTRAINT "RoleChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleChangeRequest" ADD CONSTRAINT "RoleChangeRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Segregação de funções (RN-08) imposta na própria BD, para além do código:
-- quem pede uma alteração de papel nunca pode ser quem a decide, e a alteração tem de mudar o papel
ALTER TABLE "RoleChangeRequest" ADD CONSTRAINT "RoleChangeRequest_four_eyes_check" CHECK ("decidedById" IS NULL OR "decidedById" <> "requestedById");
ALTER TABLE "RoleChangeRequest" ADD CONSTRAINT "RoleChangeRequest_role_differs_check" CHECK ("fromRole" <> "toRole");
-- Um pedido decidido tem decisor e data; um pendente não tem
ALTER TABLE "RoleChangeRequest" ADD CONSTRAINT "RoleChangeRequest_decision_check" CHECK (
  ("status" = 'PENDING' AND "decidedById" IS NULL AND "decidedAt" IS NULL)
  OR ("status" <> 'PENDING' AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL)
);
-- MFA activo implica segredo guardado
ALTER TABLE "User" ADD CONSTRAINT "User_mfa_secret_check" CHECK (NOT "mfaEnabled" OR "mfaSecret" IS NOT NULL);
