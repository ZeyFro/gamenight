-- Renomme ReminderTemplate -> MessageTemplate en préservant les données
-- (les 9 messages F7 existants). `prisma migrate diff` proposerait un
-- DROP TABLE + CREATE TABLE pour ce renommage (il compare les schémas
-- par nom de modèle, pas par intention) : destructeur, remplacé ici par
-- un RENAME explicite.
ALTER TABLE "ReminderTemplate" RENAME TO "MessageTemplate";
ALTER TABLE "MessageTemplate" RENAME CONSTRAINT "ReminderTemplate_pkey" TO "MessageTemplate_pkey";
ALTER TABLE "MessageTemplate" RENAME CONSTRAINT "ReminderTemplate_createdById_fkey" TO "MessageTemplate_createdById_fkey";

-- CreateEnum
CREATE TYPE "MessageCategory" AS ENUM ('SESSION_CREATED', 'SESSION_MODIFIED', 'REMINDER_24H', 'REMINDER_2H');

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN "categories" "MessageCategory"[];
ALTER TABLE "MessageTemplate" ADD COLUMN "variables" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill : les messages existants gardent exactement leur comportement F7
-- (tirés au hasard pour les rappels 24h et 2h) — aucun changement de
-- comportement observable pour l'utilisateur.
UPDATE "MessageTemplate"
SET categories = ARRAY['REMINDER_24H','REMINDER_2H']::"MessageCategory"[],
    variables = ARRAY['pote', 'jeu', 'heure'];
