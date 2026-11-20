-- Propositions de défis par les joueurs Ranker / High Ranker, validées par le staff (cahier 8.7). Migration
-- additive : une enum et une table, aucune table existante modifiée. À appliquer après #416.
CREATE TYPE "TowerChallengeProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "TowerChallengeProposal" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "proposerId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "instructions" VARCHAR(1500) NOT NULL,
    "rewardFloors" INTEGER NOT NULL,
    "status" "TowerChallengeProposalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" VARCHAR(500),
    "definitionId" VARCHAR(191),

    CONSTRAINT "TowerChallengeProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TowerChallengeProposal_communityId_status_createdAt_idx" ON "TowerChallengeProposal"("communityId", "status", "createdAt");
CREATE INDEX "TowerChallengeProposal_communityId_proposerId_createdAt_idx" ON "TowerChallengeProposal"("communityId", "proposerId", "createdAt");

ALTER TABLE "TowerChallengeProposal" ADD CONSTRAINT "TowerChallengeProposal_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerChallengeProposal" ADD CONSTRAINT "TowerChallengeProposal_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerChallengeProposal" ADD CONSTRAINT "TowerChallengeProposal_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
