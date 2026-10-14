-- Refonte notifications Discord — fondations de livraison (PR 1/N).
-- Additive uniquement : aucune table/colonne existante modifiée, aucun
-- appelant actuel ne lit ni n'écrit ici (voir prisma/schema.prisma pour le
-- commentaire complet et src/lib/notification-delivery.ts pour le cycle
-- claim/send/finalize). Sûr à déployer sans rien changer au comportement
-- observable de l'app.

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('SESSION', 'TOURNAMENT', 'REWARD', 'ACHIEVEMENT', 'RECAP', 'INSTANT_SESSION', 'ADMIN');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('DISCORD_CHANNEL', 'DISCORD_DM', 'IN_APP');

-- CreateEnum
CREATE TYPE "DeliveryTransport" AS ENUM ('WEBHOOK', 'BOT');

-- CreateEnum
CREATE TYPE "DeliveryOperation" AS ENUM ('SEND', 'EDIT', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'RESERVED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "eventType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "occurrence" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "transport" "DeliveryTransport" NOT NULL,
    "operation" "DeliveryOperation" NOT NULL DEFAULT 'SEND',
    "recipientKey" TEXT NOT NULL,
    "targetSlot" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "reservedBy" TEXT,
    "reservedUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "errorClass" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "discordMessageId" TEXT,
    "discordChannelId" TEXT,
    "discordThreadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationEvent_category_eventType_sourceId_occurrence_key" ON "NotificationEvent"("category", "eventType", "sourceId", "occurrence");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_eventId_channel_recipientKey_operati_key" ON "NotificationDelivery"("eventId", "channel", "recipientKey", "operation", "targetSlot");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_targetSlot_operation_status_sequence_idx" ON "NotificationDelivery"("targetSlot", "operation", "status", "sequence");

-- CreateIndex
CREATE INDEX "NotificationDelivery_reservedUntil_idx" ON "NotificationDelivery"("reservedUntil");

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
