-- Retour arrière MANUEL de 20261126230000_team_space_member_permissions_delete (jamais exécuté automatiquement).
--
-- AVANT de l'exécuter :
--   1. Revenir au code précédent (sans la suppression des salons d'équipe ni les permissions par membre) : l'ancien code suppose
--      "roleId" rempli et ne connaît pas "deletedAt".
--   2. Contrôler : SELECT count(*) FROM "DiscordTeamSpace" WHERE "roleId" IS NULL;
--      Si le résultat est > 0, le script ci-dessous ÉCHOUE avec un message explicite : renseigner d'abord un rôle valide pour ces
--      lignes, ou renoncer au retour arrière (laisser "roleId" nullable : l'ancien code la lit sans en dépendre).
-- Effet : retire le journal de suppression, puis rétablit "roleId" NOT NULL. Aucune ligne n'est supprimée.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "DiscordTeamSpace" WHERE "roleId" IS NULL) THEN
    RAISE EXCEPTION 'Retour arrière refusé : des espaces d''équipe n''ont pas de rôle ("roleId" NULL). Renseigner un rôle valide pour ces lignes, ou laisser la colonne nullable.';
  END IF;
END $$;
ALTER TABLE "DiscordTeamSpace" DROP COLUMN "deletedAt";
ALTER TABLE "DiscordTeamSpace" ALTER COLUMN "roleId" SET NOT NULL;
