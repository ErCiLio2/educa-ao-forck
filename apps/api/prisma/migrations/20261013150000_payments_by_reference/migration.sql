-- DropIndex
DROP INDEX "PaymentTransaction_reference_key";

-- AlterTable
ALTER TABLE "PaymentTransaction" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'AOA',
ADD COLUMN     "entity" TEXT,
ADD COLUMN     "hours" DECIMAL(6,2) NOT NULL DEFAULT 0,
ADD COLUMN     "offerId" TEXT,
ADD COLUMN     "referenceExpiresAt" TIMESTAMP(3),
ADD COLUMN     "validityDays" INTEGER,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(12,2);

-- CreateTable
CREATE TABLE "PackageOffer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hours" DECIMAL(6,2) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AOA',
    "validityDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PackageOffer_active_idx" ON "PackageOffer"("active");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_gateway_eventId_key" ON "PaymentWebhookEvent"("gateway", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_gateway_reference_key" ON "PaymentTransaction"("gateway", "reference");

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "PackageOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A coluna hours não deve ter default: cada pagamento guarda o pacote que comprou
ALTER TABLE "PaymentTransaction" ALTER COLUMN "hours" DROP DEFAULT;
