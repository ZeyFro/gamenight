-- Rivalités entre équipes (défi accepté par le capitaine adverse, résultat confirmé par les deux capitaines)
-- et « Intéressé » sur « Jouer maintenant ». Additive : deux enums et deux nouvelles tables, aucune table
-- existante modifiée, aucune suppression. Après #416. Appliquée après fusion par migrate-production.yml
-- (docs/MIGRATIONS.md), jamais au build.

-- CreateEnum
CREATE TYPE "TeamChallengeStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'RESULT_REPORTED', 'COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TeamChallengeOutcome" AS ENUM ('CHALLENGER_WON', 'OPPONENT_WON', 'DRAW');

-- CreateTable
CREATE TABLE "InstantSessionInterest" (
    "id" TEXT NOT NULL,
    "instantSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstantSessionInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamChallenge" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "challengerTeamId" TEXT NOT NULL,
    "opponentTeamId" TEXT NOT NULL,
    "proposedById" TEXT NOT NULL,
    "gameName" VARCHAR(80),
    "message" VARCHAR(300),
    "status" "TeamChallengeStatus" NOT NULL DEFAULT 'PROPOSED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "respondedById" TEXT,
    "reportedOutcome" "TeamChallengeOutcome",
    "reportedByTeamId" TEXT,
    "reportedById" TEXT,
    "reportedAt" TIMESTAMP(3),
    "disputeCount" INTEGER NOT NULL DEFAULT 0,
    "outcome" "TeamChallengeOutcome",
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstantSessionInterest_userId_idx" ON "InstantSessionInterest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InstantSessionInterest_instantSessionId_userId_key" ON "InstantSessionInterest"("instantSessionId", "userId");

-- CreateIndex
CREATE INDEX "TeamChallenge_communityId_status_idx" ON "TeamChallenge"("communityId", "status");

-- CreateIndex
CREATE INDEX "TeamChallenge_challengerTeamId_status_idx" ON "TeamChallenge"("challengerTeamId", "status");

-- CreateIndex
CREATE INDEX "TeamChallenge_opponentTeamId_status_idx" ON "TeamChallenge"("opponentTeamId", "status");

-- AddForeignKey
ALTER TABLE "InstantSessionInterest" ADD CONSTRAINT "InstantSessionInterest_instantSessionId_fkey" FOREIGN KEY ("instantSessionId") REFERENCES "InstantSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstantSessionInterest" ADD CONSTRAINT "InstantSessionInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamChallenge" ADD CONSTRAINT "TeamChallenge_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamChallenge" ADD CONSTRAINT "TeamChallenge_challengerTeamId_communityId_fkey" FOREIGN KEY ("challengerTeamId", "communityId") REFERENCES "CommunityTeam"("id", "communityId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamChallenge" ADD CONSTRAINT "TeamChallenge_opponentTeamId_communityId_fkey" FOREIGN KEY ("opponentTeamId", "communityId") REFERENCES "CommunityTeam"("id", "communityId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamChallenge" ADD CONSTRAINT "TeamChallenge_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamChallenge" ADD CONSTRAINT "TeamChallenge_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamChallenge" ADD CONSTRAINT "TeamChallenge_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
