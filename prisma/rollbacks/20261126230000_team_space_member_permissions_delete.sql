-- Retour arrière MANUEL de 20261126230000_team_space_member_permissions_delete (jamais exécuté automatiquement).
-- Effet : retire le journal de suppression puis rétablit roleId NOT NULL. La seconde instruction ÉCHOUE si un
-- espace a été créé sans rôle : renseigner d'abord un rôle valide pour ces lignes, sinon les laisser en place.
ALTER TABLE "DiscordTeamSpace" DROP COLUMN "deletedAt";
ALTER TABLE "DiscordTeamSpace" ALTER COLUMN "roleId" SET NOT NULL;
