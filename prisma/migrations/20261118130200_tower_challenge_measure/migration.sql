-- Validation automatique des défis « mesurables Steam » (temps de jeu depuis l'attribution, succès Steam).
-- Additive : une enum et des colonnes nullables ; aucun défi existant n'est mesuré (measureKind NULL).
-- Inerte tant que TOWER_STEAM_AUTOVALIDATE_ENABLED n'est pas "true".
CREATE TYPE "TowerChallengeMeasureKind" AS ENUM ('STEAM_PLAYTIME', 'STEAM_ACHIEVEMENT');

ALTER TABLE "TowerChallengeDefinition"
  ADD COLUMN "measureKind" "TowerChallengeMeasureKind",
  ADD COLUMN "measureAppId" INTEGER,
  ADD COLUMN "measureTarget" INTEGER,
  ADD COLUMN "measureAchievement" VARCHAR(100),
  ADD CONSTRAINT "TowerChallengeDefinition_measure_check" CHECK (
    ("measureKind" IS NULL AND "measureAppId" IS NULL AND "measureTarget" IS NULL AND "measureAchievement" IS NULL)
    OR ("measureKind" IS NOT NULL AND "measureAppId" > 0 AND "measureTarget" BETWEEN 1 AND 100000
      AND ("measureKind" = 'STEAM_ACHIEVEMENT' OR "measureAchievement" IS NULL))
  );

ALTER TABLE "TowerChallengeAttempt"
  ADD COLUMN "measureKind" "TowerChallengeMeasureKind",
  ADD COLUMN "measureAppId" INTEGER,
  ADD COLUMN "measureTarget" INTEGER,
  ADD COLUMN "measureAchievement" VARCHAR(100),
  ADD COLUMN "measureBaseline" INTEGER,
  ADD COLUMN "measureBaselineAt" TIMESTAMP(3),
  ADD COLUMN "measureValue" INTEGER,
  ADD COLUMN "measureCheckedAt" TIMESTAMP(3),
  ADD COLUMN "measureStatus" VARCHAR(16),
  ADD COLUMN "autoValidatedAt" TIMESTAMP(3),
  ADD COLUMN "doubtReportedAt" TIMESTAMP(3),
  ADD COLUMN "doubtReportedByUserId" TEXT;
