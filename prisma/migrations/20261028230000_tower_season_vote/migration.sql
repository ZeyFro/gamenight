-- Migration additive en brouillon : aucun déploiement Production.
CREATE TABLE "TowerSeasonVote" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "seasonName" VARCHAR(80) NOT NULL,
  "seasonStartAt" TIMESTAMP(3) NOT NULL,
  "seasonEndAt" TIMESTAMP(3) NOT NULL,
  "opensAt" TIMESTAMP(3) NOT NULL,
  "closesAt" TIMESTAMP(3) NOT NULL,
  "candidateUserIds" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TowerSeasonVote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TowerSeasonVote_window_check" CHECK ("opensAt" >= "seasonEndAt" AND "closesAt" = "opensAt" + INTERVAL '48 hours'),
  CONSTRAINT "TowerSeasonVote_candidates_check" CHECK (cardinality("candidateUserIds") BETWEEN 2 AND 10)
);

CREATE TABLE "TowerSeasonVoteBallot" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "voteId" TEXT NOT NULL,
  "voterUserId" TEXT NOT NULL,
  "candidateUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TowerSeasonVoteBallot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TowerSeasonVoteBallot_no_self_vote" CHECK ("voterUserId" <> "candidateUserId")
);

CREATE UNIQUE INDEX "TowerSeasonVote_id_communityId_key" ON "TowerSeasonVote"("id", "communityId");
CREATE UNIQUE INDEX "TowerSeasonVote_communityId_seasonStartAt_key" ON "TowerSeasonVote"("communityId", "seasonStartAt");
CREATE UNIQUE INDEX "TowerSeasonVoteBallot_voteId_voterUserId_key" ON "TowerSeasonVoteBallot"("voteId", "voterUserId");
CREATE INDEX "TowerSeasonVoteBallot_communityId_voteId_idx" ON "TowerSeasonVoteBallot"("communityId", "voteId");

ALTER TABLE "TowerSeasonVote" ADD CONSTRAINT "TowerSeasonVote_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerSeasonVoteBallot" ADD CONSTRAINT "TowerSeasonVoteBallot_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerSeasonVoteBallot" ADD CONSTRAINT "TowerSeasonVoteBallot_voteId_communityId_fkey"
  FOREIGN KEY ("voteId", "communityId") REFERENCES "TowerSeasonVote"("id", "communityId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerSeasonVoteBallot" ADD CONSTRAINT "TowerSeasonVoteBallot_voterUserId_fkey"
  FOREIGN KEY ("voterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerSeasonVoteBallot" ADD CONSTRAINT "TowerSeasonVoteBallot_candidateUserId_fkey"
  FOREIGN KEY ("candidateUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;