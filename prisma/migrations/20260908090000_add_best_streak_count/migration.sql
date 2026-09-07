-- Amélioration profil (stats) — historique du meilleur streak jamais
-- atteint. `streakCount` repart à 1 dès qu'un streak casse, cette valeur
-- n'existait donc nulle part ailleurs. Backfill à `streakCount` actuel :
-- c'est le meilleur minorant connaissable sans historique complet, jamais
-- pire que de partir de 0.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "bestStreakCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "User" SET "bestStreakCount" = "streakCount" WHERE "streakCount" > "bestStreakCount";
