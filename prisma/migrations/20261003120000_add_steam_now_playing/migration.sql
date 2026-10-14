-- « En jeu maintenant » sur /potes (drapeau STEAM_NOW_PLAYING_ENABLED) :
-- deux colonnes NULLABLES sur "User", aucun objet existant modifié, aucun
-- backfill. Généré par `prisma migrate diff` (schéma de main → schéma de la
-- branche) : rien d'autre.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "steamNowPlaying" TEXT,
ADD COLUMN     "steamNowPlayingSeenAt" TIMESTAMP(3);
