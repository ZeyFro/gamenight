-- Backfill explicite de la catégorie INSTANT_SESSION — même règle EXACTE
-- que le backfill TOURNAMENT (`20260922090001_backfill_tournament_notification_preferences`) :
-- `enabled = NOT "silenceReminders"` — un compte ayant déjà demandé le
-- silence global reçoit `enabled = false` dès l'introduction de cette
-- catégorie, jamais une réactivation silencieuse. Sans ce backfill, le
-- même résultat aurait de toute façon été obtenu par le repli applicatif
-- (`isPersonalNotificationEnabled`, absence de ligne → `NOT silenceReminders`)
-- — ce backfill rend la règle EXPLICITE en base, cohérente avec la façon
-- dont SESSION/ROULETTE/TOURNAMENT ont été introduites.
INSERT INTO "UserNotificationPreference" ("userId", "category", "enabled", "updatedAt")
SELECT "id", 'INSTANT_SESSION', NOT "silenceReminders", CURRENT_TIMESTAMP
FROM "User";
