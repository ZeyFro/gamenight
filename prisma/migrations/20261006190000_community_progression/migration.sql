-- PR B : progression et provenance communautaires. Aucun DROP de données.
BEGIN;

INSERT INTO "Community" ("id", "slug", "name", "status", "activatedAt", "updatedAt")
SELECT 'cm' || md5(random()::text || clock_timestamp()::text), 'default', 'GameNight', 'ACTIVE'::"CommunityStatus", now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Community" WHERE "slug" = 'default');

CREATE TABLE "CommunityMemberStats" (
  "communityId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "xpTotal" INTEGER NOT NULL DEFAULT 0,
  "streakCount" INTEGER NOT NULL DEFAULT 0,
  "streakLastActiveAt" TIMESTAMP(3),
  "bestStreakCount" INTEGER NOT NULL DEFAULT 0,
  "tournamentsParticipatedCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "CommunityMemberStats_pkey" PRIMARY KEY ("communityId", "userId"),
  CONSTRAINT "CommunityMemberStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Copier le solde EXACT : la somme du ledger ignore mises débitées et resets de saison.
INSERT INTO "CommunityMemberStats" ("communityId", "userId", "xpTotal", "streakCount", "streakLastActiveAt", "bestStreakCount", "tournamentsParticipatedCount")
SELECT c."id", u."id", u."xpTotal", u."streakCount", u."streakLastActiveAt", u."bestStreakCount", COALESCE(s."tournamentsParticipatedCount", 0)
FROM "User" u CROSS JOIN "Community" c LEFT JOIN "UserLifetimeStats" s ON s."userId" = u."id"
WHERE c."slug" = 'default';

ALTER TABLE "XpEvent" ADD COLUMN "communityId" TEXT;
ALTER TABLE "LevelUpEvent" ADD COLUMN "communityId" TEXT;
ALTER TABLE "UserBadge" ADD COLUMN "communityId" TEXT;
UPDATE "XpEvent" SET "communityId" = (SELECT "id" FROM "Community" WHERE "slug" = 'default');
UPDATE "LevelUpEvent" SET "communityId" = (SELECT "id" FROM "Community" WHERE "slug" = 'default');
UPDATE "UserBadge" SET "communityId" = (SELECT "id" FROM "Community" WHERE "slug" = 'default');
ALTER TABLE "XpEvent" ALTER COLUMN "communityId" SET NOT NULL;
ALTER TABLE "LevelUpEvent" ALTER COLUMN "communityId" SET NOT NULL;
ALTER TABLE "UserBadge" ALTER COLUMN "communityId" SET NOT NULL;

DROP INDEX "XpEvent_userId_reason_sourceId_key";
DROP INDEX "UserBadge_userId_badgeId_key";
CREATE UNIQUE INDEX "XpEvent_communityId_userId_reason_sourceId_key" ON "XpEvent"("communityId", "userId", "reason", "sourceId");
CREATE UNIQUE INDEX "UserBadge_communityId_userId_badgeId_key" ON "UserBadge"("communityId", "userId", "badgeId");
CREATE INDEX "XpEvent_communityId_createdAt_idx" ON "XpEvent"("communityId", "createdAt");
CREATE INDEX "LevelUpEvent_communityId_createdAt_idx" ON "LevelUpEvent"("communityId", "createdAt");
CREATE INDEX "UserBadge_communityId_unlockedAt_idx" ON "UserBadge"("communityId", "unlockedAt");
CREATE INDEX "CommunityMemberStats_communityId_xpTotal_idx" ON "CommunityMemberStats"("communityId", "xpTotal");
CREATE INDEX "CommunityMemberStats_communityId_streakLastActiveAt_idx" ON "CommunityMemberStats"("communityId", "streakLastActiveAt");

ALTER TABLE "SessionResult" ADD COLUMN "communityId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "communityId" TEXT;
ALTER TABLE "NotificationEvent" ADD COLUMN "communityId" TEXT;
ALTER TABLE "NotificationEvent" ADD COLUMN "payload" JSONB;
UPDATE "SessionResult" r SET "communityId" = s."communityId" FROM "Session" s WHERE r."sessionId" = s."id";
UPDATE "Notification" n SET "communityId" = s."communityId" FROM "Session" s WHERE n."relatedSessionId" = s."id" AND n."type" <> 'INSTANT_SESSION_INVITE';
UPDATE "Notification" n SET "communityId" = s."communityId" FROM "InstantSession" s WHERE n."relatedSessionId" = s."id" AND n."type" = 'INSTANT_SESSION_INVITE';
UPDATE "NotificationEvent" n SET "communityId" = s."communityId" FROM "Session" s WHERE n."sourceId" = s."id" AND n."category" = 'SESSION';
UPDATE "NotificationEvent" n SET "communityId" = t."communityId" FROM "Tournament" t WHERE n."sourceId" = t."id" AND n."category" = 'TOURNAMENT';
UPDATE "NotificationEvent" n SET "communityId" = r."communityId" FROM "Roulette" r WHERE n."sourceId" = r."id" AND n."category" = 'ROULETTE';
UPDATE "NotificationEvent" n SET "communityId" = s."communityId" FROM "InstantSession" s WHERE n."sourceId" = s."id" AND n."category" = 'INSTANT_SESSION';
UPDATE "SessionResult" SET "communityId" = (SELECT "id" FROM "Community" WHERE "slug" = 'default') WHERE "communityId" IS NULL;
UPDATE "Notification" SET "communityId" = (SELECT "id" FROM "Community" WHERE "slug" = 'default') WHERE "communityId" IS NULL;
UPDATE "NotificationEvent" SET "communityId" = (SELECT "id" FROM "Community" WHERE "slug" = 'default') WHERE "communityId" IS NULL;
CREATE INDEX "SessionResult_communityId_idx" ON "SessionResult"("communityId");
CREATE INDEX "Notification_communityId_idx" ON "Notification"("communityId");
CREATE INDEX "NotificationEvent_communityId_idx" ON "NotificationEvent"("communityId");

COMMIT;
