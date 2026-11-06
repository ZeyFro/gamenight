-- Préparation uniquement : aucune application Production autorisée.
CREATE TYPE "TowerChallengeMode" AS ENUM ('SOLO', 'TEAM');
CREATE TYPE "TowerChallengeAttemptStatus" AS ENUM ('ASSIGNED', 'SUBMITTED', 'APPROVED', 'REJECTED');
ALTER TABLE "Community" ADD COLUMN "towerChallengesEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "TowerChallengeDefinition" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "mode" "TowerChallengeMode" NOT NULL DEFAULT 'SOLO',
  "title" VARCHAR(120) NOT NULL,
  "instructions" VARCHAR(1500) NOT NULL,
  "rewardFloors" INTEGER NOT NULL CHECK ("rewardFloors" > 0),
  "gameId" VARCHAR(191),
  "active" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TowerChallengeDefinition_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TowerChallengeAttempt" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "definitionId" TEXT NOT NULL,
  "requestKey" VARCHAR(100) NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "instructions" VARCHAR(1500) NOT NULL,
  "rewardFloors" INTEGER NOT NULL CHECK ("rewardFloors" > 0),
  "assignedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" "TowerChallengeAttemptStatus" NOT NULL DEFAULT 'ASSIGNED',
  "submittedAt" TIMESTAMP(3),
  "proofText" VARCHAR(1500),
  "proofChannelId" VARCHAR(20),
  "proofMessageId" VARCHAR(20),
  "publicationConsent" BOOLEAN NOT NULL DEFAULT false,
  "rewardedAt" TIMESTAMP(3),
  CONSTRAINT "TowerChallengeAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TowerChallengeAttempt_duration_check" CHECK ("expiresAt" = "assignedAt" + INTERVAL '48 hours'),
  CONSTRAINT "TowerChallengeAttempt_proof_check" CHECK (
    "submittedAt" IS NULL OR ("proofText" IS NOT NULL AND "proofChannelId" IS NOT NULL AND "proofMessageId" IS NOT NULL)
  ),
  CONSTRAINT "TowerChallengeAttempt_reward_check" CHECK (
    ("status" = 'APPROVED') = ("rewardedAt" IS NOT NULL)
  )
);
CREATE TABLE "TowerChallengeVote" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "approve" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TowerChallengeVote_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TowerChallengeProgress" (
  "communityId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "floorsClimbed" BIGINT NOT NULL DEFAULT 0 CHECK ("floorsClimbed" >= 0),
  "lastSoloClaimAt" TIMESTAMP(3),
  CONSTRAINT "TowerChallengeProgress_pkey" PRIMARY KEY ("communityId", "userId")
);

CREATE UNIQUE INDEX "TowerChallengeDefinition_id_communityId_key" ON "TowerChallengeDefinition"("id", "communityId");
CREATE INDEX "TowerChallengeDefinition_communityId_active_mode_idx" ON "TowerChallengeDefinition"("communityId", "active", "mode");
CREATE UNIQUE INDEX "TowerChallengeAttempt_id_communityId_key" ON "TowerChallengeAttempt"("id", "communityId");
CREATE UNIQUE INDEX "TowerChallengeAttempt_communityId_userId_requestKey_key" ON "TowerChallengeAttempt"("communityId", "userId", "requestKey");
CREATE INDEX "TowerChallengeAttempt_communityId_userId_rewardedAt_idx" ON "TowerChallengeAttempt"("communityId", "userId", "rewardedAt");
CREATE INDEX "TowerChallengeAttempt_communityId_status_submittedAt_idx" ON "TowerChallengeAttempt"("communityId", "status", "submittedAt");
CREATE UNIQUE INDEX "TowerChallengeVote_attemptId_userId_key" ON "TowerChallengeVote"("attemptId", "userId");
CREATE INDEX "TowerChallengeVote_communityId_attemptId_idx" ON "TowerChallengeVote"("communityId", "attemptId");

ALTER TABLE "TowerChallengeDefinition" ADD CONSTRAINT "TowerChallengeDefinition_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerChallengeAttempt" ADD CONSTRAINT "TowerChallengeAttempt_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerChallengeAttempt" ADD CONSTRAINT "TowerChallengeAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerChallengeAttempt" ADD CONSTRAINT "TowerChallengeAttempt_definitionId_communityId_fkey" FOREIGN KEY ("definitionId", "communityId") REFERENCES "TowerChallengeDefinition"("id", "communityId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "TowerChallengeVote" ADD CONSTRAINT "TowerChallengeVote_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerChallengeVote" ADD CONSTRAINT "TowerChallengeVote_attemptId_communityId_fkey" FOREIGN KEY ("attemptId", "communityId") REFERENCES "TowerChallengeAttempt"("id", "communityId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerChallengeVote" ADD CONSTRAINT "TowerChallengeVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerChallengeProgress" ADD CONSTRAINT "TowerChallengeProgress_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerChallengeProgress" ADD CONSTRAINT "TowerChallengeProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
