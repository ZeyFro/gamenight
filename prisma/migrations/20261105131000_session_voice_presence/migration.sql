CREATE TABLE "SessionVoicePresenceInterval" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" VARCHAR(20) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionVoicePresenceInterval_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionVoicePresenceInterval_sessionId_userId_channelId_startedAt_key"
ON "SessionVoicePresenceInterval"("sessionId", "userId", "channelId", "startedAt");

CREATE INDEX "SessionVoicePresenceInterval_sessionId_userId_idx"
ON "SessionVoicePresenceInterval"("sessionId", "userId");

ALTER TABLE "SessionVoicePresenceInterval"
ADD CONSTRAINT "SessionVoicePresenceInterval_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionVoicePresenceInterval"
ADD CONSTRAINT "SessionVoicePresenceInterval_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
