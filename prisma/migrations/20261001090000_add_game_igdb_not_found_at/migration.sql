-- Backfill IGDB : marque datée « jeu introuvable sur IGDB » pour ne plus le
-- retenter à chaque passage. Colonne nullable sans défaut, purement additive
-- (aucune ligne existante modifiée, aucun backfill, aucun verrou long).
ALTER TABLE "Game" ADD COLUMN "igdbNotFoundAt" TIMESTAMP(3);
