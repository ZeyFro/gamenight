-- Chantier XP/niveaux/rangs (PR 5/9, version vote-entre-potes) — migration
-- purement additive, aucune perte de données : deux nouvelles valeurs
-- d'enum, deux nouvelles colonnes sur Session (défaut/nullable sûrs, pas
-- de backfill nécessaire), trois nouvelles tables vides au départ.

-- AlterEnum
ALTER TYPE "MessageCategory" ADD VALUE 'SESSION_AWARDS';

-- AlterEnum
ALTER TYPE "XpReason" ADD VALUE 'SUPERLATIVE_AWARD';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "superlativeVotingClosed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "superlativeVotingDeadline" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SuperlativeCategory" (
    "id" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "xpReward" INTEGER NOT NULL DEFAULT 20,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedById" TEXT NOT NULL,
    "modifiedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuperlativeCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuperlativeVote" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "voterUserId" TEXT NOT NULL,
    "votedForUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuperlativeVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuperlativeAward" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "winnerUserId" TEXT NOT NULL,
    "voteCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuperlativeAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuperlativeVote_sessionId_categoryId_voterUserId_key" ON "SuperlativeVote"("sessionId", "categoryId", "voterUserId");

-- CreateIndex
CREATE UNIQUE INDEX "SuperlativeAward_sessionId_categoryId_key" ON "SuperlativeAward"("sessionId", "categoryId");

-- AddForeignKey
ALTER TABLE "SuperlativeCategory" ADD CONSTRAINT "SuperlativeCategory_modifiedById_fkey" FOREIGN KEY ("modifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperlativeVote" ADD CONSTRAINT "SuperlativeVote_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperlativeVote" ADD CONSTRAINT "SuperlativeVote_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SuperlativeCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperlativeVote" ADD CONSTRAINT "SuperlativeVote_voterUserId_fkey" FOREIGN KEY ("voterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperlativeVote" ADD CONSTRAINT "SuperlativeVote_votedForUserId_fkey" FOREIGN KEY ("votedForUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperlativeAward" ADD CONSTRAINT "SuperlativeAward_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperlativeAward" ADD CONSTRAINT "SuperlativeAward_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SuperlativeCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperlativeAward" ADD CONSTRAINT "SuperlativeAward_winnerUserId_fkey" FOREIGN KEY ("winnerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
