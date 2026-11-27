-- Marque la coupure d'accès déjà appliquée à un espace de soirée.
-- Les colonnes threadId/voiceChannelId restent les seuls identifiants utilisés
-- pour la suppression ; ce marqueur évite seulement de rejouer les appels
-- Discord à chaque passage du balayage.
ALTER TABLE "SessionDiscordSpace" ADD COLUMN "accessRevokedAt" TIMESTAMP(3);
