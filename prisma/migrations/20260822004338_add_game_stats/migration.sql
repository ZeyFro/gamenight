-- Chantier XP/niveaux/rangs (PR 4/9) — migration purement additive,
-- aucune perte de données : deux nouveaux enums, deux nouvelles tables.

-- CreateEnum
CREATE TYPE "StatType" AS ENUM ('INT', 'FLOAT', 'BOOL');

-- CreateEnum
CREATE TYPE "SuperlativeRule" AS ENUM ('MAX', 'MIN', 'TRUE_COUNT');

-- CreateTable
CREATE TABLE "GameStatType" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "StatType" NOT NULL,
    "higherIsBetter" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameStatType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Superlative" (
    "id" TEXT NOT NULL,
    "gameStatTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rule" "SuperlativeRule" NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Superlative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameStatType_gameId_key_key" ON "GameStatType"("gameId", "key");

-- AddForeignKey
ALTER TABLE "GameStatType" ADD CONSTRAINT "GameStatType_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Superlative" ADD CONSTRAINT "Superlative_gameStatTypeId_fkey" FOREIGN KEY ("gameStatTypeId") REFERENCES "GameStatType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
