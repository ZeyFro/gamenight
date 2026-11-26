-- Décision du 26/11/2026 : un tournoi d'équipes lancé avec exactement 5 équipes se joue en poule unique (10 matchs, classement).
-- AlterTable : colonne ajoutée avec une valeur par défaut (additif). Les tournois existants restent en arbre éliminatoire.
ALTER TABLE "TournamentTeamSettings" ADD COLUMN "roundRobin" BOOLEAN NOT NULL DEFAULT false;
