-- Retour arrière MANUEL de 20261126230000_team_space_member_permissions_delete (jamais exécuté automatiquement).
--
-- AVANT de l'exécuter :
--   1. Revenir au code précédent (sans la suppression des salons d'équipe ni les permissions par membre) : l'ancien code suppose
--      "roleId" rempli et ne connaît pas "deletedAt".
--   2. Contrôler : SELECT count(*) FROM "DiscordTeamSpace" WHERE "roleId" IS NULL;
--      Si le résultat est > 0, la dernière instruction ÉCHOUE d'elle-même (PostgreSQL : la colonne "roleId" contient des valeurs
--      NULL) : renseigner d'abord un rôle valide pour ces lignes, ou renoncer au retour arrière (laisser "roleId" nullable :
--      l'ancien code la lit sans en dépendre). Comme le script est transactionnel côté outil, rien n'est alors modifié.
-- Effet : retire le journal de suppression ("deletedAt" : les dates de suppression sont PERDUES), puis rétablit "roleId" NOT NULL.
-- Aucune ligne n'est supprimée.
-- (Pas de bloc DO $$ : le script reste exécutable ligne à ligne par src/lib/migrations-rollback-files.ts.)
ALTER TABLE "DiscordTeamSpace" DROP COLUMN "deletedAt";
ALTER TABLE "DiscordTeamSpace" ALTER COLUMN "roleId" SET NOT NULL;
