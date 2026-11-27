-- Retour arrière MANUEL de 20261126220000_player_classified_forum_relay (jamais exécuté automatiquement).
-- Effet : supprime les compteurs de pings forum et les colonnes de relais ; ces données sont perdues.
-- Avant : revenir à un code antérieur à cette PR (aucun code ne lit ces colonnes ; les laisser en place est sans risque).
DROP TABLE "PlayerClassifiedPing";
DROP INDEX "PlayerClassified_forumThreadId_idx";
ALTER TABLE "PlayerClassified"
  DROP COLUMN "forumThreadId",
  DROP COLUMN "forumRelayedAt",
  DROP COLUMN "forumClosedAt",
  DROP COLUMN "pingedAt";
