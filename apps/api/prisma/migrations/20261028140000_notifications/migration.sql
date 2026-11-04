-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('EMAIL', 'PUSH', 'SMS');

-- CreateEnum
CREATE TYPE "NotifType" AS ENUM (
  'PAYMENT_CONFIRMED',
  'PAYMENT_FAILED',
  'BOOKING_ENROLLED',
  'BOOKING_ENROLLMENT_CANCELLED',
  'TUTOR_APPROVED',
  'TUTOR_REJECTED',
  'ROLE_CHANGE_APPROVED',
  'ROLE_CHANGE_REJECTED',
  'CONTENT_READY'
);

-- AlterTable: número de telefone (opcional, usado pelo canal SMS)
ALTER TABLE "User" ADD COLUMN "phoneNumber" TEXT;

-- CreateTable: preferências de notificação por utilizador/canal/tipo
CREATE TABLE "NotificationPreference" (
  "userId"  TEXT NOT NULL,
  "channel" "DeliveryChannel" NOT NULL,
  "type"    "NotifType" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId", "channel", "type"),
  CONSTRAINT "NotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable: configuração global de canais (gerida pelo Admin)
CREATE TABLE "ChannelConfig" (
  "channel"   "DeliveryChannel" NOT NULL,
  "enabled"   BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "ChannelConfig_pkey" PRIMARY KEY ("channel")
);

-- CreateTable: tokens de push por dispositivo
CREATE TABLE "PushToken" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "token"     TEXT NOT NULL,
  "platform"  TEXT NOT NULL,
  "endpoint"  TEXT NOT NULL,
  "p256dh"    TEXT,
  "auth"      TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushToken_token_key" UNIQUE ("token"),
  CONSTRAINT "PushToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PushToken_userId_idx" ON "PushToken"("userId");

-- Seed: todos os canais activos por defeito
INSERT INTO "ChannelConfig" ("channel", "enabled", "updatedAt") VALUES
  ('EMAIL', true, NOW()),
  ('PUSH',  true, NOW()),
  ('SMS',   true, NOW());
