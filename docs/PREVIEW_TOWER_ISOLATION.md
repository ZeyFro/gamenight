# Preview GameNight : aucune opération vers The Tower

**Invariants obligatoires avant connexion de la branche Neon de recette :**

- `VERCEL_ENV=preview` : `checkCronAuth` retourne HTTP 503 même avec un CRON_SECRET valide ; ne configurer aucun cron-job.org sur l'URL Preview.
- `VERCEL_ENV=preview` : `postToDiscord` refuse les webhooks, et `discordRequest` refuse toute méthode autre que GET, y compris les messages d'interaction (PATCH), POST, PUT et DELETE. Une Preview ne peut donc pas répondre aux interactions Discord. Elle est destinée à la recette **web uniquement**.
- Retirer de l'environnement Preview **toutes** les autorisations de publication Discord, même si elles sont protégées par un flag. Ne jamais donner à la recette les IDs du serveur réel ni ses canaux.
- Pour tester des commandes dans Discord, utiliser un projet/environnement distinct approuvé, avec un bot et une guild de test. Cette politique doit alors rester active pour toutes les Previews Vercel.
- Les variables `AUTH_URL`, `AUTH_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` et `DATABASE_URL` de la recette doivent être isolées ; pas de secret en Markdown ni dans les logs.

## Variables Preview : désactiver explicitement

`NOTIFICATION_EXECUTOR_ENABLED`, `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`, `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED`, `DISCORD_DM_SESSION_ENABLED`, `DISCORD_DM_TOURNAMENT_ENABLED`, `DISCORD_DM_ROULETTE_ENABLED`, `DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED`, `DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED`, `DISCORD_THREAD_CLEANUP_ENABLED`, `DISCORD_THREAD_CLOSE_ON_END_ENABLED`, `COMMUNITY_AUTO_CREATE_ENABLED`, `COMMUNITY_SETUP_COMMAND_ENABLED`, `TOWER_DISCORD_PREFLIGHT_ENABLED`, `TOWER_CHALLENGES_ENABLED`, `TOWER_DISCORD_ANNOUNCE_ENABLED`.

## Variables à ne pas fournir à Preview

`DISCORD_BOT_TOKEN`, `DISCORD_WEBHOOK_URL`, `DISCORD_BOT_GUILD_ID`, `DISCORD_BOT_SESSION_CHANNEL_ID`, `DISCORD_BOT_TOURNAMENT_CHANNEL_ID`, `TOWER_DISCORD_GUILD_ID`, `TOWER_DISCORD_CHANNEL_ID`, `TOWER_DISCORD_GENERAL_CHANNEL_ID`.

## Base Neon

La branche existante `preview-gamenight` est issue de septembre 2026, actuellement archivée, 58 tables et 72 migrations Prisma. Production : 96 tables et 118 migrations au relevé du 4 novembre. `User`, `Community`, `Membership` sont vides. Appliquer uniquement les migrations Prisma manquantes sur cette branche ; aucune copie de données production ni reset depuis production.

**Ne configurer aucune Preview pour écriture** avant la preuve que `DATABASE_URL` (host seulement) pointe sur la compute `preview-gamenight` et non production ; vérifier la liste des variables héritées et la Preview exacte. Les variables Preview branch-scoped `preview-tower` concernent une branche Git supprimée et ne suffisent pas.

## Tests attendus avant opération

1. `checkCronAuth` en Preview retourne 503, même avec Bearer valide.
2. `discordRequest` POST/PATCH/DELETE ne déclenche pas de `fetch`.
3. `postToDiscord` ne déclenche pas de `fetch`.
4. Aucune tâche cron-job.org ne cible la Preview ; aucune variable Discord production n'y est accessible.
5. Sur production, les chemins préexistants restent inchangés.

La PR de ce document et de son verrou est en brouillon ; **aucune variable, cron, base ou salon modifié**.
