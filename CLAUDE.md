# GameNight

App de soirées jeux entre potes. Détails fonctionnels : `README.md`, `SPEC-gamenight.md`.

## Stack
Next.js 16 (App Router) · React 19 · Prisma 6 (adapter Neon) · Postgres Neon · Auth.js v5 (Discord OAuth) · Vercel Hobby (pas de cron < 1/jour : crons externes) · Vitest.

## Commandes
- `npm run lint` · `npx tsc --noEmit` · `npx next build` (⚠ `npm run build` lance `prisma migrate deploy` : jamais sans `DATABASE_URL` locale)
- `npx vitest run <fichier>` : tests unitaires ciblés
- Tests d'intégration : Postgres Docker local, jamais Neon
  1. `docker run -d --name gamenight-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=gamenight_test -p 127.0.0.1:55439:5432 postgres:16-alpine`
  2. `DATABASE_URL=<url ci-dessous> npx prisma migrate deploy`
  3. `TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_test npm run test:postgres`
- Vérifier le port libre (`netstat -ano | grep :55439`) et utiliser `127.0.0.1`, pas `localhost`.
- Pas de `.env` dans le repo (seulement `.env.example`) ; pas de python (utiliser node).

## Règles
- Jamais la base Neon en test ni en local. Tests uniquement via `TEST_DATABASE_URL`.
- Jamais de vraie notification Discord depuis un test ou un essai.
- PR en Draft ; s'arrêter à « PR ouverte, build vert » (check Vercel). Pas de merge/déploiement sans demande.
- Test « skipped » = à signaler explicitement, jamais présenté comme passé.
- Aucune nouvelle dépendance sans demander.
- Migrations Prisma existantes immuables (hook) : toujours en créer une nouvelle. Changement Prisma seulement si justifié.
- Pas de refactor large, pas de try/catch silencieux.
- Commits/PR en français, style `type(scope): …`.

## Notifications Discord
`enqueue` (`createNotificationEvent` + `enqueueDelivery`, `src/lib/notification-delivery.ts`) → lignes `NotificationEvent` / `NotificationDelivery` → executor (`src/lib/notification-executor.ts`, route cron `/api/cron/notification-executor`) qui réclame les livraisons (bail), résout le contenu puis appelle Discord (`discord-rest.ts`, `discord-dm.ts`). Les actions n'appellent pas Discord directement quand le chemin bot est actif.

## Switches d'environnement
Tous OFF par défaut : actifs uniquement si la valeur vaut exactement `true` (`MODE=execute` pour les cleanups ; sinon dry-run).
- `NOTIFICATION_EXECUTOR_ENABLED`
- `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED` · `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED`
- `DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED`
- `DISCORD_DM_SESSION_ENABLED` · `DISCORD_DM_TOURNAMENT_ENABLED` · `DISCORD_DM_ROULETTE_ENABLED`
- `DISCORD_THREAD_CLEANUP_ENABLED` + `DISCORD_THREAD_CLEANUP_MODE`
- `RETENTION_CLEANUP_ENABLED` + `RETENTION_CLEANUP_MODE`
Routes `/api/cron/*` fail-closed : 503 sans `CRON_SECRET`.

## Style de réponse
Réponses courtes, en français. Pas de recap inutile ni de re-explication du diff.

## Garde-fous (`.claude/`)
Hooks : lecture/écriture `.env*` et commandes contenant `neon.tech` bloquées ; modification de migrations existantes bloquée ; `eslint --fix` auto sur le fichier édité.
