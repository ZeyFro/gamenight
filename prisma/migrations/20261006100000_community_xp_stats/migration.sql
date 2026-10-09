-- PR B : XP, niveaux, badges et streaks par communauté. Aucune suppression de données.
--
-- Les lignes historiques (XpEvent, LevelUpEvent, UserBadge) sont rattachées à la communauté
-- `default` (créée si elle manque, mêmes valeurs que `ensureDefaultCommunityRecord`), et le solde
-- XP / le streak / le compteur de tournois existants de chaque utilisateur sont COPIÉS dans
-- `CommunityMemberStats` pour `default`. Les colonnes `User.xpTotal`, `streakCount`,
-- `streakLastActiveAt`, `bestStreakCount` et la table `UserLifetimeStats` restent en place (héritées,
-- plus lues ni écrites par l'application) : l'étape « contract » n'est pas faite ici.
--
-- Fenêtre de déploiement : l'ancien code écrit XpEvent/LevelUpEvent/UserBadge sans communauté (NOT NULL
-- ci-dessous) et utilise les anciennes clés uniques ; merger hors des heures de jeu, après un backup Neon.
BEGIN;

INSERT INTO "Community" ("id", "slug", "name", "status", "activatedAt", "updatedAt")
SELECT 'cm' || md5(random()::text || clock_timestamp()::text), 'default', 'GameNight', 'ACTIVE'::"CommunityStatus", now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Community" WHERE "slug" = 'default');

-- CreateTable
CREATE TABLE "CommunityMemberStats" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "xpTotal" INTEGER NOT NULL DEFAULT 0,
    "streakCount" INTEGER NOT NULL DEFAULT 0,
    "streakLastActiveAt" TIMESTAMP(3),
    "bestStreakCount" INTEGER NOT NULL DEFAULT 0,
    "tournamentsParticipatedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityMemberStats_pkey" PRIMARY KEY ("id")
);

-- AlterTable (colonnes d'abord nullables : backfill puis NOT NULL)
ALTER TABLE "XpEvent" ADD COLUMN "communityId" TEXT;
ALTER TABLE "LevelUpEvent" ADD COLUMN "communityId" TEXT;
ALTER TABLE "UserBadge" ADD COLUMN "communityId" TEXT;

UPDATE "XpEvent" SET "communityId" = (SELECT "id" FROM "Community" WHERE "slug" = 'default') WHERE "communityId" IS NULL;
UPDATE "LevelUpEvent" SET "communityId" = (SELECT "id" FROM "Community" WHERE "slug" = 'default') WHERE "communityId" IS NULL;
UPDATE "UserBadge" SET "communityId" = (SELECT "id" FROM "Community" WHERE "slug" = 'default') WHERE "communityId" IS NULL;

ALTER TABLE "XpEvent" ALTER COLUMN "communityId" SET NOT NULL;
ALTER TABLE "LevelUpEvent" ALTER COLUMN "communityId" SET NOT NULL;
ALTER TABLE "UserBadge" ALTER COLUMN "communityId" SET NOT NULL;

-- Soldes, streaks et compteurs existants → communauté default (copie : les colonnes d'origine ne bougent pas).
INSERT INTO "CommunityMemberStats" (
    "id", "communityId", "userId", "xpTotal", "streakCount", "streakLastActiveAt",
    "bestStreakCount", "tournamentsParticipatedCount", "updatedAt"
)
SELECT
    'cm' || md5(random()::text || clock_timestamp()::text || u."id"),
    (SELECT "id" FROM "Community" WHERE "slug" = 'default'),
    u."id",
    u."xpTotal",
    u."streakCount",
    u."streakLastActiveAt",
    u."bestStreakCount",
    COALESCE(l."tournamentsParticipatedCount", 0),
    now()
FROM "User" AS u
LEFT JOIN "UserLifetimeStats" AS l ON l."userId" = u."id"
WHERE u."xpTotal" <> 0
   OR u."streakCount" <> 0
   OR u."bestStreakCount" <> 0
   OR u."streakLastActiveAt" IS NOT NULL
   OR COALESCE(l."tournamentsParticipatedCount", 0) <> 0
   OR EXISTS (SELECT 1 FROM "XpEvent" AS e WHERE e."userId" = u."id");

-- DropIndex (clés d'idempotence globales, remplacées par des clés par communauté)
DROP INDEX "UserBadge_userId_badgeId_key";
DROP INDEX "XpEvent_userId_reason_sourceId_key";

-- CreateIndex
CREATE INDEX "CommunityMemberStats_communityId_xpTotal_idx" ON "CommunityMemberStats"("communityId", "xpTotal");
CREATE INDEX "CommunityMemberStats_userId_idx" ON "CommunityMemberStats"("userId");
CREATE UNIQUE INDEX "CommunityMemberStats_communityId_userId_key" ON "CommunityMemberStats"("communityId", "userId");
CREATE INDEX "LevelUpEvent_communityId_createdAt_idx" ON "LevelUpEvent"("communityId", "createdAt");
CREATE INDEX "UserBadge_communityId_unlockedAt_idx" ON "UserBadge"("communityId", "unlockedAt");
CREATE UNIQUE INDEX "UserBadge_communityId_userId_badgeId_key" ON "UserBadge"("communityId", "userId", "badgeId");
CREATE INDEX "XpEvent_communityId_createdAt_idx" ON "XpEvent"("communityId", "createdAt");
CREATE INDEX "XpEvent_communityId_userId_reason_idx" ON "XpEvent"("communityId", "userId", "reason");
CREATE UNIQUE INDEX "XpEvent_communityId_userId_reason_sourceId_key" ON "XpEvent"("communityId", "userId", "reason", "sourceId");

-- AddForeignKey
ALTER TABLE "XpEvent" ADD CONSTRAINT "XpEvent_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityMemberStats" ADD CONSTRAINT "CommunityMemberStats_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityMemberStats" ADD CONSTRAINT "CommunityMemberStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LevelUpEvent" ADD CONSTRAINT "LevelUpEvent_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
