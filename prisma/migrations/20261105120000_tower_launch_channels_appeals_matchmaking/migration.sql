ALTER TABLE "TowerChallengeAttempt"
  ADD COLUMN "proofCode" VARCHAR(12),
  ADD COLUMN "rejectedAt" TIMESTAMP(3),
  ADD COLUMN "staffReportedAt" TIMESTAMP(3),
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD CONSTRAINT "TowerChallengeAttempt_proofCode_format_check"
    CHECK ("proofCode" IS NULL OR "proofCode" ~ '^TWR-[A-Z0-9]{8}$');

CREATE UNIQUE INDEX "TowerChallengeAttempt_communityId_proofCode_key"
  ON "TowerChallengeAttempt"("communityId", "proofCode");
CREATE INDEX "TowerChallengeAttempt_communityId_status_submittedAt_staffReportedAt_archivedAt_idx"
  ON "TowerChallengeAttempt"("communityId", "status", "submittedAt", "staffReportedAt", "archivedAt");

CREATE TYPE "TowerChallengeAppealStatus" AS ENUM ('OPEN', 'UPHELD', 'OVERTURNED');
CREATE TABLE "TowerChallengeAppeal" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "status" "TowerChallengeAppealStatus" NOT NULL DEFAULT 'OPEN',
  "reviewerUserId" TEXT,
  "arbiterUserId" TEXT,
  "decisionReason" VARCHAR(1000),
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "TowerChallengeAppeal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TowerChallengeAppeal_reason_not_empty_check"
    CHECK (length(btrim("reason")) > 0),
  CONSTRAINT "TowerChallengeAppeal_communityId_fkey"
    FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "TowerChallengeAppeal_attemptId_communityId_fkey"
    FOREIGN KEY ("attemptId", "communityId") REFERENCES "TowerChallengeAttempt"("id", "communityId") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "TowerChallengeAppeal_arbiterUserId_fkey"
    FOREIGN KEY ("arbiterUserId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TowerChallengeAppeal_attemptId_communityId_key"
  ON "TowerChallengeAppeal"("attemptId", "communityId");
CREATE INDEX "TowerChallengeAppeal_communityId_status_createdAt_idx"
  ON "TowerChallengeAppeal"("communityId", "status", "createdAt");
CREATE INDEX "TowerChallengeAppeal_communityId_status_dueAt_idx"
  ON "TowerChallengeAppeal"("communityId", "status", "dueAt");
CREATE INDEX "TowerChallengeAppeal_communityId_status_arbiterUserId_idx"
  ON "TowerChallengeAppeal"("communityId", "status", "arbiterUserId");

ALTER TYPE "UserNotificationCategory" ADD VALUE 'REWARD';
CREATE TYPE "UserNotificationChannel" AS ENUM ('IN_APP', 'WEB_PUSH', 'DISCORD_DM', 'DISCORD_MENTION');
CREATE TABLE "UserNotificationChannelPreference" (
  "userId" TEXT NOT NULL,
  "category" "UserNotificationCategory" NOT NULL,
  "channel" "UserNotificationChannel" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserNotificationChannelPreference_pkey" PRIMARY KEY ("userId", "category", "channel"),
  CONSTRAINT "UserNotificationChannelPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TYPE "PartyType" AS ENUM ('CASUAL', 'COMPETITIVE', 'COOPERATIVE');
CREATE TYPE "MicrophoneRequirement" AS ENUM ('REQUIRED', 'OPTIONAL', 'NONE');
ALTER TABLE "PlayerClassified"
  ADD COLUMN "startsAt" TIMESTAMP(3),
  ADD COLUMN "durationMinutes" INTEGER,
  ADD COLUMN "partyType" "PartyType",
  ADD COLUMN "platform" VARCHAR(40),
  ADD COLUMN "microphoneRequirement" "MicrophoneRequirement",
  ADD CONSTRAINT "PlayerClassified_durationMinutes_check"
    CHECK ("durationMinutes" IS NULL OR "durationMinutes" BETWEEN 1 AND 10080);
