CREATE TABLE "SessionVoicePresenceGap" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "resumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionVoicePresenceGap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionVoicePresenceGap_sessionId_generation_startedAt_key"
ON "SessionVoicePresenceGap"("sessionId", "generation", "startedAt");

CREATE INDEX "SessionVoicePresenceGap_sessionId_startedAt_idx"
ON "SessionVoicePresenceGap"("sessionId", "startedAt");

CREATE INDEX "SessionVoicePresenceGap_expiresAt_idx"
ON "SessionVoicePresenceGap"("expiresAt");

ALTER TABLE "SessionVoicePresenceGap"
ADD CONSTRAINT "SessionVoicePresenceGap_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve the single latest gap already available in the aggregate control row.
INSERT INTO "SessionVoicePresenceGap" ("id", "sessionId", "generation", "startedAt", "resumedAt", "expiresAt", "createdAt")
SELECT
    md5('gamenight-voice-gap:' || control."sessionId" || ':' || control."generation"::text || ':' || extract(epoch FROM control."gapStartedAt")::text),
    control."sessionId",
    control."generation",
    control."gapStartedAt",
    control."lastGapAt",
    CASE WHEN control."stopAt" IS NULL THEN NULL ELSE control."stopAt" + INTERVAL '30 days' END,
    control."updatedAt"
FROM "SessionVoicePresenceControl" AS control
JOIN "Session" AS session ON session."id" = control."sessionId"
WHERE control."gapDetected" = true
  AND control."gapStartedAt" IS NOT NULL
  AND control.status <> 'PURGED'
  AND session.status <> 'CANCELLED';
