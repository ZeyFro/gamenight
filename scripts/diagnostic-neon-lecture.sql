-- Diagnostic en lecture seule. Aucun RESET, EXPLAIN ANALYZE, VACUUM ou changement de configuration.
-- Les statistiques sont cumulées depuis stats_reset ; elles ne mesurent pas les CU-heures.

SELECT now() AS releve_utc,
       pg_size_pretty(pg_database_size(current_database())) AS taille_base,
       stats_reset, xact_commit, xact_rollback, tup_returned, tup_fetched
FROM pg_stat_database
WHERE datname = current_database();

SELECT application_name, state, count(*) AS connexions
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
GROUP BY application_name, state
ORDER BY connexions DESC;

SELECT relname AS table_name, n_live_tup, n_dead_tup,
       seq_scan, seq_tup_read, idx_scan,
       pg_size_pretty(pg_total_relation_size(relid)) AS taille_totale
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;

SELECT e.category, e."eventType", d.channel, d.operation, d.status,
       count(*) AS livraisons, min(d."createdAt") AS plus_ancienne_utc,
       min(d."nextAttemptAt") AS prochaine_tentative_utc
FROM "NotificationDelivery" d
JOIN "NotificationEvent" e ON e.id = d."eventId"
GROUP BY e.category, e."eventType", d.channel, d.operation, d.status
ORDER BY plus_ancienne_utc;
