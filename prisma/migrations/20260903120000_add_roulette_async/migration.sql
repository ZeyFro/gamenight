-- Sprint 3 : roue du gambling en mode asynchrone.
CREATE TYPE "RouletteStatus" AS ENUM ('OPEN', 'SPINNING', 'DONE');

CREATE TABLE "Roulette" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "status" "RouletteStatus" NOT NULL DEFAULT 'OPEN',
    "resultGameId" TEXT,
    "resultSessionId" TEXT,
    "notifiedUserIds" JSONB,
    "reminderSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Roulette_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Roulette_status_deadline_idx" ON "Roulette"("status", "deadline");

ALTER TABLE "Roulette" ADD CONSTRAINT "Roulette_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "RouletteEntry" (
    "id" TEXT NOT NULL,
    "rouletteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouletteEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RouletteEntry_rouletteId_userId_gameId_key" ON "RouletteEntry"("rouletteId", "userId", "gameId");

ALTER TABLE "RouletteEntry" ADD CONSTRAINT "RouletteEntry_rouletteId_fkey" FOREIGN KEY ("rouletteId") REFERENCES "Roulette"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RouletteEntry" ADD CONSTRAINT "RouletteEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RouletteEntry" ADD CONSTRAINT "RouletteEntry_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
