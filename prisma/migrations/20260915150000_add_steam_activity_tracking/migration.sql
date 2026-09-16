-- Fix (cron Steam surdimensionné — investigation "activité Steam absente
-- chez les autres potes") : le cron léger `steam-library-sync` (toutes les
-- ~2 min) ne doit plus réimporter toute la bibliothèque pour rafraîchir
-- l'activité affichée. Deux nouveaux champs, distincts de
-- `steamLastSyncAt` (réservé à une synchronisation COMPLÈTE réussie) :
-- `steamActivityCheckedAt` (dernière tentative du cron léger, succès ou
-- erreur confondus) et `steamFullSyncAttemptedAt` (dernière tentative du
-- cron d'import complet à basse cadence, utilisé pour la rotation
-- round-robin — jamais `steamLastSyncAt`, qui ne doit indiquer un succès
-- qu'après coup). Voir src/lib/steam.ts et les deux routes cron
-- concernées pour le détail.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "steamActivityCheckedAt" TIMESTAMP(3),
ADD COLUMN     "steamFullSyncAttemptedAt" TIMESTAMP(3);
