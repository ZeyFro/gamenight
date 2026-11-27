-- D5 : permissions par membre (plus de rôle obligatoire) et journal de suppression.
-- ATTENTION : relâche une contrainte (roleId NOT NULL). Retour arrière manuel obligatoire :
-- prisma/rollbacks/20261126230000_team_space_member_permissions_delete.sql
-- Il échoue volontairement si un espace existe sans rôle : renseigner un rôle valide avant,
-- ou laisser la colonne nullable (l'ancien code la lit sans en dépendre).
ALTER TABLE "DiscordTeamSpace" ALTER COLUMN "roleId" DROP NOT NULL;
ALTER TABLE "DiscordTeamSpace" ADD COLUMN "deletedAt" TIMESTAMP(3);
