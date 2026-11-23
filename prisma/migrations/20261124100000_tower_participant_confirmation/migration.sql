-- Audit du 23/11/2026, constat 1.5 : un participant de défi d'équipe Tower n'est récompensé que s'il est confirmé par le capitaine.
-- AlterTable : colonne ajoutée, nullable, sans valeur par défaut (additif).
ALTER TABLE "TowerChallengeAttemptParticipant" ADD COLUMN "confirmedAt" TIMESTAMP(3);

-- Rattrapage : les participants DÉJÀ présents avant cette migration restent confirmés (donc récompensables, comme avant).
-- Seules les inscriptions faites après le déploiement attendent la confirmation du capitaine.
UPDATE "TowerChallengeAttemptParticipant" SET "confirmedAt" = "joinedAt" WHERE "confirmedAt" IS NULL;
