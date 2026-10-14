-- Chantier nettoyage réel du stockage (V2) — nouvelle ligne singleton du
-- verrou `CronLock` (voir `src/lib/cron-lock.ts` pour l'acquisition/
-- libération, comparaison sur `token`, bail TTL) réservée au cron de
-- rétention (`src/app/api/cron/retention-cleanup/route.ts`) : protège
-- contre deux exécutions concurrentes du nettoyage (batché, avec appels
-- Discord), même raisonnement que le verrou "reminders" existant. Table
-- `CronLock` déjà créée par la migration `20260914120000_add_cron_lock` —
-- seule une nouvelle LIGNE est ajoutée ici, non verrouillée au départ.
-- Aucune donnée réelle n'est purgée par cette migration elle-même : le
-- cron reste désactivé par défaut (`RETENTION_CLEANUP_ENABLED`), voir le
-- README pour la procédure d'activation.

INSERT INTO "CronLock" ("name", "lockedAt", "token")
VALUES ('retention-cleanup', NULL, NULL)
ON CONFLICT ("name") DO NOTHING;
