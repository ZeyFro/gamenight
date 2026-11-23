-- Retour arrière MANUEL de 20261121100000_account_deletion_log (jamais exécuté automatiquement).
-- Effet : supprime le journal des suppressions de compte (aucune donnée personnelle, mais l'historique des suppressions est perdu).
-- Avant : éteindre ACCOUNT_DELETION_ENABLED et revenir à un code qui ne lit plus la table.
-- Après : `npx prisma migrate resolve --rolled-back 20261121100000_account_deletion_log` (voir docs/MIGRATIONS.md).
DROP TABLE "AccountDeletionLog";
