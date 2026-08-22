-- Chantier XP/niveaux/rangs (PR 2/9) — migration purement additive, aucune
-- perte de données : nouvel enum XpReason, nouvelle catégorie LEVEL_UP sur
-- l'enum MessageCategory existant, nouvelles colonnes User (défauts sûrs
-- pour les lignes existantes), nouvelle table XpEvent.

-- CreateEnum
CREATE TYPE "XpReason" AS ENUM ('CREATE_SESSION', 'VOTE', 'PARTICIPATE', 'AVAILABILITY_FIRST', 'STEAM_LINK_FIRST');

-- AlterEnum
ALTER TYPE "MessageCategory" ADD VALUE 'LEVEL_UP';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "streakCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "streakLastActiveAt" TIMESTAMP(3),
ADD COLUMN     "xpTotal" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "XpEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" "XpReason" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "XpEvent_userId_idx" ON "XpEvent"("userId");

-- CreateIndex
CREATE INDEX "XpEvent_createdAt_idx" ON "XpEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "XpEvent_userId_reason_sourceId_key" ON "XpEvent"("userId", "reason", "sourceId");

-- CreateIndex
CREATE INDEX "User_xpTotal_idx" ON "User"("xpTotal");

-- AddForeignKey
ALTER TABLE "XpEvent" ADD CONSTRAINT "XpEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
