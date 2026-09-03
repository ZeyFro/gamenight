-- Sprint 4 PR-A (Pronostics + Paris d'XP + Dernière activité Steam) —
-- migration purement additive, aucune perte de données.

-- AlterEnum
ALTER TYPE "XpReason" ADD VALUE 'PRONOSTIC_CORRECT';
ALTER TYPE "XpReason" ADD VALUE 'XP_BET_WON';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PRONOSTIC';
ALTER TYPE "NotificationType" ADD VALUE 'XP_BET';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastPlayedGame" TEXT,
ADD COLUMN     "lastPlayedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Pronostic" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "predictedUserId" TEXT NOT NULL,
    "correct" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pronostic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpBet" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "won" BOOLEAN,
    "allIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpBet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pronostic_sessionId_voterId_key" ON "Pronostic"("sessionId", "voterId");

-- CreateIndex
CREATE UNIQUE INDEX "XpBet_sessionId_voterId_key" ON "XpBet"("sessionId", "voterId");

-- AddForeignKey
ALTER TABLE "Pronostic" ADD CONSTRAINT "Pronostic_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pronostic" ADD CONSTRAINT "Pronostic_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pronostic" ADD CONSTRAINT "Pronostic_predictedUserId_fkey" FOREIGN KEY ("predictedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpBet" ADD CONSTRAINT "XpBet_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpBet" ADD CONSTRAINT "XpBet_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpBet" ADD CONSTRAINT "XpBet_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
