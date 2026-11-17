-- Empreinte de la base, LECTURE SEULE : compteurs et dates, aucune donnée personnelle.
-- Source unique : exécutée telle quelle par scripts/restore-fingerprint.mjs (workflow « Précontrôle
-- Production ») et à copier dans la console SQL de Neon sur une branche restaurée, pour comparer.
SELECT 'migrations_terminees' AS mesure, COUNT(*)::text AS valeur FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
UNION ALL SELECT 'derniere_migration', COALESCE(MAX(migration_name), '-') FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
UNION ALL SELECT 'User', COUNT(*)::text FROM "User"
UNION ALL SELECT 'Community', COUNT(*)::text FROM "Community"
UNION ALL SELECT 'Membership', COUNT(*)::text FROM "Membership"
UNION ALL SELECT 'CommunityTeam', COUNT(*)::text FROM "CommunityTeam"
UNION ALL SELECT 'CommunityTeamMember', COUNT(*)::text FROM "CommunityTeamMember"
UNION ALL SELECT 'Game', COUNT(*)::text FROM "Game"
UNION ALL SELECT 'Session', COUNT(*)::text FROM "Session"
UNION ALL SELECT 'XpEvent', COUNT(*)::text FROM "XpEvent"
UNION ALL SELECT 'session_la_plus_recente', COALESCE(MAX("createdAt")::text, '-') FROM "Session"
UNION ALL SELECT 'xp_event_le_plus_recent', COALESCE(MAX("createdAt")::text, '-') FROM "XpEvent"
ORDER BY 1;
