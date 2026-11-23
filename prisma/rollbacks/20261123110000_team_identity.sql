-- Retour arrière MANUEL de 20261123110000_team_identity (jamais exécuté automatiquement).
-- Effet : retire la couleur et l'emblème des équipes (choix des capitaines perdus).
-- Avant : revenir à un code antérieur à la PR #526.
ALTER TABLE "CommunityTeam" DROP COLUMN "emblem";
ALTER TABLE "CommunityTeam" DROP COLUMN "color";
