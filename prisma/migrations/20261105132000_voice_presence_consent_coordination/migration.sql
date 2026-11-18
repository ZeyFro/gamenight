CREATE TYPE "SessionVoicePresenceControlStatus" AS ENUM (
  'ACTIVE',
  'STOP_REQUESTED',
  'PURGE_REQUESTED',
  'FINALIZED',
  'PURGED'
);

CREATE TABLE "SessionVoicePresenceConsent" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "SessionVoicePresenceConsent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionVoicePresenceConsent_sessionId_userId_key"
  ON "SessionVoicePresenceConsent"("sessionId", "userId");
CREATE INDEX "SessionVoicePresenceConsent_userId_consentedAt_idx"
  ON "SessionVoicePresenceConsent"("userId", "consentedAt");
CREATE INDEX "SessionVoicePresenceConsent_expiresAt_idx"
  ON "SessionVoicePresenceConsent"("expiresAt");

ALTER TABLE "SessionVoicePresenceInterval"
  ADD COLUMN "consentId" TEXT,
  ADD COLUMN "endedAt" TIMESTAMP(3),
  ADD COLUMN "expiresAt" TIMESTAMP(3);

UPDATE "SessionVoicePresenceInterval"
SET "endedAt" = "startedAt" + ("durationSeconds" * interval '1 second'),
    "expiresAt" = "createdAt" + interval '30 days';

ALTER TABLE "SessionVoicePresenceInterval"
  ALTER COLUMN "endedAt" SET NOT NULL,
  ALTER COLUMN "expiresAt" SET NOT NULL;

CREATE INDEX "SessionVoicePresenceInterval_expiresAt_idx"
  ON "SessionVoicePresenceInterval"("expiresAt");

CREATE TABLE "SessionVoicePresenceControl" (
  "sessionId" TEXT NOT NULL,
  "status" "SessionVoicePresenceControlStatus" NOT NULL DEFAULT 'ACTIVE',
  "generation" INTEGER NOT NULL DEFAULT 0,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "heartbeatAt" TIMESTAMP(3),
  "stopAt" TIMESTAMP(3),
  "gapDetected" BOOLEAN NOT NULL DEFAULT false,
  "lastGapAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionVoicePresenceControl_pkey" PRIMARY KEY ("sessionId")
);

CREATE INDEX "SessionVoicePresenceControl_status_leaseExpiresAt_idx"
  ON "SessionVoicePresenceControl"("status", "leaseExpiresAt");

ALTER TABLE "SessionVoicePresenceConsent"
  ADD CONSTRAINT "SessionVoicePresenceConsent_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionVoicePresenceConsent"
  ADD CONSTRAINT "SessionVoicePresenceConsent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionVoicePresenceInterval"
  ADD CONSTRAINT "SessionVoicePresenceInterval_consentId_fkey"
  FOREIGN KEY ("consentId") REFERENCES "SessionVoicePresenceConsent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionVoicePresenceControl"
  ADD CONSTRAINT "SessionVoicePresenceControl_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
