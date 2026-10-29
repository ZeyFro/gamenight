-- Additive preparation for Tower team challenges. Apply only after review.
ALTER TABLE "TowerChallengeAttempt" ADD COLUMN "teamId" TEXT;

CREATE UNIQUE INDEX "TowerChallengeAttempt_communityId_teamId_requestKey_key"
  ON "TowerChallengeAttempt"("communityId", "teamId", "requestKey");
CREATE INDEX "TowerChallengeAttempt_communityId_teamId_status_idx"
  ON "TowerChallengeAttempt"("communityId", "teamId", "status");

CREATE TABLE "TowerChallengeAttemptParticipant" (
  "communityId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rewardedAt" TIMESTAMP(3),
  CONSTRAINT "TowerChallengeAttemptParticipant_pkey" PRIMARY KEY ("attemptId", "userId")
);
CREATE INDEX "TowerChallengeAttemptParticipant_communityId_userId_rewardedAt_idx"
  ON "TowerChallengeAttemptParticipant"("communityId", "userId", "rewardedAt");
CREATE INDEX "TowerChallengeAttemptParticipant_communityId_rewardedAt_idx"
  ON "TowerChallengeAttemptParticipant"("communityId", "rewardedAt");

ALTER TABLE "TowerChallengeAttempt"
  ADD CONSTRAINT "TowerChallengeAttempt_teamId_communityId_fkey"
  FOREIGN KEY ("teamId", "communityId") REFERENCES "CommunityTeam"("id", "communityId")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "TowerChallengeAttemptParticipant"
  ADD CONSTRAINT "TowerChallengeAttemptParticipant_communityId_fkey"
  FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerChallengeAttemptParticipant"
  ADD CONSTRAINT "TowerChallengeAttemptParticipant_attemptId_communityId_fkey"
  FOREIGN KEY ("attemptId", "communityId") REFERENCES "TowerChallengeAttempt"("id", "communityId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerChallengeAttemptParticipant"
  ADD CONSTRAINT "TowerChallengeAttemptParticipant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
