-- Multi-communautés, PR9 — clés composites par communauté pour GameWishlist,
-- GroupAchievement, GroupSessionStats, GroupGameStat et GroupActiveWeek.
--
-- Étape « contract » du chantier : `communityId` (nullable depuis la PR7) devient
-- OBLIGATOIRE et entre dans la clé, pour que deux communautés aient chacune leur
-- ligne (même jeu en wishlist, mêmes trophées, mêmes compteurs). Aucune donnée
-- n'est supprimée : les lignes existantes sont rattachées à la communauté par
-- défaut (créée ici si elle manque, mêmes valeurs que `ensureDefaultCommunityRecord`,
-- qui la retrouve par son `slug` et complète `discordGuildId` plus tard).
-- Seuls des index/contraintes d'unicité et clés primaires sont remplacés ;
-- les clés `onDelete` passent de SET NULL à CASCADE (colonne désormais NOT NULL).
--
-- Fenêtre de déploiement : entre cette migration (build Vercel) et la mise en
-- ligne du nouveau code, l'ancien code peut échouer à écrire dans ces tables
-- (upsert de GroupGameStat/GroupActiveWeek par l'ancienne clé, création de
-- GameWishlist sans communityId). À déployer hors des heures de jeu.

INSERT INTO "Community" ("id", "slug", "name", "status", "activatedAt", "updatedAt")
SELECT 'cm' || md5(random()::text || clock_timestamp()::text), 'default', 'GameNight', 'ACTIVE'::"CommunityStatus", now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Community" WHERE "slug" = 'default');

UPDATE "GroupAchievement" SET "communityId" = (SELECT "id" FROM "Community" WHERE "slug" = 'default') WHERE "communityId" IS NULL;
UPDATE "GroupSessionStats" SET "communityId" = (SELECT "id" FROM "Community" WHERE "slug" = 'default') WHERE "communityId" IS NULL;
UPDATE "GroupGameStat" SET "communityId" = (SELECT "id" FROM "Community" WHERE "slug" = 'default') WHERE "communityId" IS NULL;
UPDATE "GroupActiveWeek" SET "communityId" = (SELECT "id" FROM "Community" WHERE "slug" = 'default') WHERE "communityId" IS NULL;
UPDATE "GameWishlist" SET "communityId" = (SELECT "id" FROM "Community" WHERE "slug" = 'default') WHERE "communityId" IS NULL;

-- DropForeignKey
ALTER TABLE "GroupAchievement" DROP CONSTRAINT "GroupAchievement_communityId_fkey";

-- DropForeignKey
ALTER TABLE "GroupSessionStats" DROP CONSTRAINT "GroupSessionStats_communityId_fkey";

-- DropForeignKey
ALTER TABLE "GroupGameStat" DROP CONSTRAINT "GroupGameStat_communityId_fkey";

-- DropForeignKey
ALTER TABLE "GroupActiveWeek" DROP CONSTRAINT "GroupActiveWeek_communityId_fkey";

-- DropForeignKey
ALTER TABLE "GameWishlist" DROP CONSTRAINT "GameWishlist_communityId_fkey";

-- DropIndex
DROP INDEX "GroupAchievement_key_key";

-- DropIndex
DROP INDEX "GroupAchievement_communityId_idx";

-- DropIndex
DROP INDEX "GroupSessionStats_communityId_idx";

-- DropIndex
DROP INDEX "GroupGameStat_communityId_idx";

-- DropIndex
DROP INDEX "GroupActiveWeek_communityId_idx";

-- DropIndex
DROP INDEX "GameWishlist_communityId_idx";

-- DropIndex
DROP INDEX "GameWishlist_gameId_key";

-- AlterTable
ALTER TABLE "GroupAchievement" ALTER COLUMN "communityId" SET NOT NULL;

-- AlterTable
ALTER TABLE "GroupSessionStats" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "communityId" SET NOT NULL;

-- AlterTable
ALTER TABLE "GroupGameStat" DROP CONSTRAINT "GroupGameStat_pkey",
ALTER COLUMN "communityId" SET NOT NULL,
ADD CONSTRAINT "GroupGameStat_pkey" PRIMARY KEY ("communityId", "gameId");

-- AlterTable
ALTER TABLE "GroupActiveWeek" DROP CONSTRAINT "GroupActiveWeek_pkey",
ALTER COLUMN "communityId" SET NOT NULL,
ADD CONSTRAINT "GroupActiveWeek_pkey" PRIMARY KEY ("communityId", "weekStart");

-- AlterTable
ALTER TABLE "GameWishlist" ALTER COLUMN "communityId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "GroupAchievement_communityId_key_key" ON "GroupAchievement"("communityId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "GroupSessionStats_communityId_key" ON "GroupSessionStats"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "GameWishlist_communityId_gameId_key" ON "GameWishlist"("communityId", "gameId");

-- AddForeignKey
ALTER TABLE "GroupAchievement" ADD CONSTRAINT "GroupAchievement_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSessionStats" ADD CONSTRAINT "GroupSessionStats_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupGameStat" ADD CONSTRAINT "GroupGameStat_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupActiveWeek" ADD CONSTRAINT "GroupActiveWeek_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameWishlist" ADD CONSTRAINT "GameWishlist_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

