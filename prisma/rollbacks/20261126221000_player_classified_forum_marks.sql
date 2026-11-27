-- Retour arrière MANUEL de 20261126221000_player_classified_forum_marks (jamais exécuté automatiquement).
-- Effet : supprime les trois marques de relais forum ; ces valeurs sont perdues (le relais retombe alors sur forumThreadId / forumClosedAt seuls).
-- Avant : revenir à un code antérieur à cette migration (aucun code antérieur ne lit ces colonnes ; les laisser en place est sans risque).
ALTER TABLE "PlayerClassified"
  DROP COLUMN "forumPostingAt",
  DROP COLUMN "forumRemovedAt",
  DROP COLUMN "forumSweptAt";
