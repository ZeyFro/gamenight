-- PR A : clés par communauté et provenance durable. Aucune suppression de données.
-- Fenêtre de déploiement : l’ancien code utilise les clés globales ; merger hors des heures de jeu.
BEGIN;

INSERT INTO "Community" ("id", "slug", "name", "status", "activatedAt", "updatedAt")
SELECT 'cm' || md5(random()::text || clock_timestamp()::text), 'default', 'GameNight', 'ACTIVE'::"CommunityStatus", now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Community" WHERE "slug" = 'default');

UPDATE "WeeklyChallenge" SET "communityId" = (SELECT "id" FROM "Community" WHERE "slug" = 'default') WHERE "communityId" IS NULL;
UPDATE "MonthlyRecap" SET "communityId" = (SELECT "id" FROM "Community" WHERE "slug" = 'default') WHERE "communityId" IS NULL;
UPDATE "Season" SET "communityId" = (SELECT "id" FROM "Community" WHERE "slug" = 'default') WHERE "communityId" IS NULL;

-- DropForeignKey
ALTER TABLE "WeeklyChallenge" DROP CONSTRAINT "WeeklyChallenge_communityId_fkey";

-- DropForeignKey
ALTER TABLE "MonthlyRecap" DROP CONSTRAINT "MonthlyRecap_communityId_fkey";

-- DropForeignKey
ALTER TABLE "Season" DROP CONSTRAINT "Season_communityId_fkey";

-- DropIndex
DROP INDEX "WeeklyChallenge_communityId_idx";

-- DropIndex
DROP INDEX "WeeklyChallenge_weekStart_key";

-- DropIndex
DROP INDEX "MonthlyRecap_communityId_idx";

-- DropIndex
DROP INDEX "MonthlyRecap_year_month_key";

-- DropIndex
DROP INDEX "Season_number_key";

-- DropIndex
DROP INDEX "Season_communityId_idx";

-- AlterTable
ALTER TABLE "Pronostic" ADD COLUMN     "communityId" TEXT;

-- AlterTable
ALTER TABLE "XpBet" ADD COLUMN     "communityId" TEXT;

-- AlterTable
ALTER TABLE "SuperlativeAward" ADD COLUMN     "communityId" TEXT;

-- AlterTable
ALTER TABLE "WeeklyChallenge" ALTER COLUMN "communityId" SET NOT NULL;

-- AlterTable
ALTER TABLE "MonthlyRecap" ALTER COLUMN "communityId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Season" ALTER COLUMN "communityId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Pronostic_communityId_idx" ON "Pronostic"("communityId");

-- CreateIndex
CREATE INDEX "XpBet_communityId_idx" ON "XpBet"("communityId");

-- CreateIndex
CREATE INDEX "SuperlativeAward_communityId_idx" ON "SuperlativeAward"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyChallenge_communityId_weekStart_key" ON "WeeklyChallenge"("communityId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyRecap_communityId_year_month_key" ON "MonthlyRecap"("communityId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Season_communityId_number_key" ON "Season"("communityId", "number");

-- AddForeignKey
ALTER TABLE "WeeklyChallenge" ADD CONSTRAINT "WeeklyChallenge_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyRecap" ADD CONSTRAINT "MonthlyRecap_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Les résumés dont la soirée a déjà été purgée restent dans default (NULL).
UPDATE "Pronostic" AS child SET "communityId" = parent."communityId" FROM "Session" AS parent WHERE child."sessionId" = parent."id";
UPDATE "XpBet" AS child SET "communityId" = parent."communityId" FROM "Session" AS parent WHERE child."sessionId" = parent."id";
UPDATE "SuperlativeAward" AS child SET "communityId" = parent."communityId" FROM "Session" AS parent WHERE child."sessionId" = parent."id";
COMMIT;
