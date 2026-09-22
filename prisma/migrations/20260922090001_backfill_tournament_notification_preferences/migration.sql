-- Backfill explicite de la catégorie TOURMANENT — séparé de la migration
-- précédente (qui ajoute la valeur d'enum) car PostgreSQL interdit
-- d'utiliser une valeur d'enum tout juste ajoutée par ALTER TYPE ... ADD
-- VALUE DANS LA MÊME transaction (chaque fichier migration.sql de Prisma
-- s'exécute dans sa propre transaction).
--
-- Même règle EXACTE que le backfill SESSION/ROULETTE d'origine
-- (20260916140000_add_user_notification_preferences) : `enabled = NOT
-- "silenceReminders"` — un compte ayant déjà demandé le silence global
-- reçoit `enabled = false` pour TOURNAMENT dès son introduction, jamais
-- une réactivation silencieuse. Sans ce backfill, le même résultat aurait
-- de toute façon été obtenu par le repli applicatif (`isPersonalNotificationEnabled`,
-- notification-preferences.ts, absence de ligne → `NOT silenceReminders`)
-- — ce backfill rend la règle EXPLICITE en base, cohérente avec la façon
-- dont SESSION/ROULETTE ont été introduites, plutôt que de compter
-- indéfiniment sur le repli applicatif pour cette catégorie.
INSERT INTO "UserNotificationPreference" ("userId", "category", "enabled", "updatedAt")
SELECT "id", 'TOURNAMENT', NOT "silenceReminders", CURRENT_TIMESTAMP
FROM "User";
