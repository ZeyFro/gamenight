# GameNight

App de soirées jeux entre potes. Détails fonctionnels : `README.md`, `SPEC-gamenight.md`.

## État du projet
V1 terminée (périmètre `SPEC` §6). V2 (bot Discord : fils, MP, nettoyage, « Jouer maintenant ») en cours de **stabilisation** : PR #121 à #128 mergées (backfill IGDB Coop, tests du nettoyage des fils, « Jouer maintenant » durée max 3 h et 500 « use server », avatar/klipy/rotation Steam, crons longs en 202 + `after()`, test de rappel sans date en dur). Phase 6 : docs de fin de V2 (README : MP #116, tableau des env, tableau des crons, « Reporté après V2 »).

## Stack
Next.js 16 (App Router) · React 19 · Prisma 6 (adapter Neon) · Postgres Neon · Auth.js v5 (Discord OAuth) · Vercel Hobby (pas de cron < 1/jour : crons externes) · Vitest.

## Commandes
- `npm run lint` · `npx tsc --noEmit` · `npx next build` (⚠ `npm run build` lance `prisma migrate deploy` hors `VERCEL_ENV=preview` : jamais sans `DATABASE_URL` locale pour la validation)
- `npx vitest run <fichier>` : tests unitaires ciblés
- Tests d'intégration : Postgres Docker local, jamais Neon. En session cloud, le hook SessionStart (`.claude/hooks/session-start.mjs`) fait les étapes 1-2 sans Docker (Postgres 16, 127.0.0.1:55439) et exporte `TEST_DATABASE_URL` : lancer directement l'étape 3.
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
- Migrations Prisma existantes immuables (hook) : toujours en créer une nouvelle, additive (appliquée par `prisma migrate deploy` au build de production ; jamais au build Preview). Changement Prisma seulement si justifié.
- Pas de refactor large, pas de try/catch silencieux.
- Commits/PR en français, style `type(scope): …`.

## Pièges appris
- Un fichier `"use server"` ne peut exporter que des fonctions async (sinon 500 sur toutes ses actions, invisible de tsc/lint/build) : gardé par `src/lib/use-server-exports.test.ts`.
- Les tests d'intégration partagent une base (TRUNCATE) : `npm run test:postgres` (un fichier à la fois), jamais deux runs en parallèle.
- Modèles collectifs : accès via le client scopé `scopedDb` (`getScopedPrisma(userId)`, `src/lib/community-scoped-client.ts`), jamais `prisma.<modèle>` directement dans le nouveau code (garde `src/lib/community-scope.test.ts`). Création = `communityId` scalaire obligatoire.
- `GameWishlist`, `GroupAchievement`, `GroupSessionStats`, `GroupGameStat`, `GroupActiveWeek` : `communityId` OBLIGATOIRE et dans la clé (PR9), jamais `null` : communauté par défaut = `getDefaultCommunityId()`, aussi isolation éteinte. Trophées annoncés sur Discord pour `default` seulement.
- `auth()` appelé depuis un composant serveur ou une server action jette les `Set-Cookie` : rien n'y est persisté dans le JWT (`src/auth.ts`).
- `/api/backfill/igdb-coop` accepte GET et POST (`Authorization: Bearer <CRON_SECRET>`) et répond 202 ; le traitement tourne dans `after()`.
- cron-job.org coupe à 30 s : les routes longues répondent 202 et travaillent dans `after()` (`seed-reconcile`, `steam-library-full-sync`, `igdb-coop` : `maxDuration` 300, budget 240 s ; `steam-store`, `game-news` : 60 s). Un `début` sans `fin` dans les logs = coupure plateforme. Tableau complet : README « Référence : routes cron et backfill ».
- klipy : les liens de page (`klipy.com/…`) sont refusés, seuls les liens d'image (`static.klipy.com/…`) fonctionnent (`src/lib/banner-url.ts`).

## Notifications Discord
`enqueue` (`createNotificationEvent` + `enqueueDelivery`, `src/lib/notification-delivery.ts`) → lignes `NotificationEvent` / `NotificationDelivery` → executor (`src/lib/notification-executor.ts`, route cron `/api/cron/notification-executor`) qui réclame les livraisons (bail), résout le contenu puis appelle Discord (`discord-rest.ts`, `discord-dm.ts`). Les actions n'appellent pas Discord directement quand le chemin bot est actif. Avec `NOTIFICATION_EXECUTOR_ENABLED=true`, `enqueueDelivery` planifie l'executor via `after()` (`notification-executor-kick.ts`) ; le cron n'est que le filet (retries, éditions différées).

Règles de ping (#116) : le créateur reçoit les MP mais n'est jamais mentionné dans le fil.
- Soirée : création, changement de date, « Soirée validée », rappel = mention dans le fil ET MP. Modification/fin = annonce et MP d'invitation édités, jamais de nouveau MP. MP fermé : mention de secours pour le créateur seulement.
- Tournoi : création = mention dans le fil ET MP ; lancement/fin/annulation = MP d'invitation édité.
- Roulette : jamais de mention ; MP d'invitation édité à la fin, MP de rappel conservé.

## Switches d'environnement
- `SESSION_CHRONICLES_ENABLED` : chronique texte des soirées DONE, éditée par le créateur et lisible selon l'accès privé à la soirée ; archive Lore paginée par serveur ; OFF par défaut, migration `session_chronicles`. Toute chronique non vide bloque la purge automatique même flag OFF ; suppression volontaire inchangée.
- `SESSION_PREPARATION_ENABLED` : checklist de préparation individuelle sur les soirées planifiées (installation, mise à jour, micro et lobby) ; désactivée par défaut
Tous OFF par défaut : actifs uniquement si la valeur vaut exactement `true` (`MODE=execute` pour les cleanups ; sinon dry-run). Routes `/api/cron/*` fail-closed : 503 sans `CRON_SECRET`.
- `NOTIFICATION_EXECUTOR_ENABLED` : sans lui l'executor ne réclame ni n'envoie rien (`{enabled:false}`)
- `GAME_PREPARATION_TIME_ENABLED` : affiche et autorise la saisie d'une durée estimée (1–10 080 minutes) sourcée sur la fiche jeu ; OFF par défaut
- `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED` · `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED` : annonces soirées / tournois via le bot ; exigent aussi `DISCORD_BOT_GUILD_ID` et le salon (`…_SESSION_CHANNEL_ID` / `…_TOURNAMENT_CHANNEL_ID`)
- `DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED` : invitation « Jouer maintenant » par MP (aucun salon requis)
- `COMMUNITY_AUTO_CREATE_ENABLED` : création automatique de communautés PENDING (webhook d'événements Discord « application autorisée » + cron `community-guild-sync`) ; exige `DISCORD_APP_PUBLIC_KEY` (signature Ed25519 du webhook)
- `COMMUNITY_SETUP_COMMAND_ENABLED` : commande Discord `/gamenight setup` (permission « Gérer le serveur », endpoint `/api/discord/interactions`) qui active la communauté de son serveur sans validation manuelle ; exige `DISCORD_APP_PUBLIC_KEY` ; le PING de l'endpoint est acquitté même éteint
- `COMMUNITY_CHANNELS_ENABLED` : salons d'annonce par communauté (`CommunityChannelConfig`) pour soirées et tournois ; éteint = variables `DISCORD_BOT_*` seules, allumé = repli sur elles uniquement pour la communauté `default`
- `COMMUNITY_ISOLATION_ENABLED` : isolation des soirées, tournois, potes et classements par communauté (Membership ACTIVE) ; éteint = aucun filtre. Couverture partielle (voir README, PR4) : ne pas activer en production avant la fin du backlog
- `COMMUNITY_PICKER_ENABLED` : sélecteur de serveur `/serveurs` (0 serveur = message, 1 = redirection, plusieurs = choix) et porte sur accueil, `/sessions`, `/tournois`, `/classement` ; `User.activeCommunityId` est une préférence revalidée contre les Membership ACTIFS, jamais une autorisation ; exige la migration `add_user_active_community`
- `COMMUNITY_ADMIN_ENABLED` : onglet « Communautés » de `/admin` (admins) : activer une communauté PENDING et choisir ses salons SESSION / TOURNAMENT, vérifiés auprès de Discord ; sans migration ; les salons ne servent qu'avec `COMMUNITY_CHANNELS_ENABLED`
- `DISCORD_DM_SESSION_ENABLED` · `DISCORD_DM_TOURNAMENT_ENABLED` · `DISCORD_DM_ROULETTE_ENABLED` : création de nouveaux MP (les MP déjà en file sont traités) ; les MP de soirée exigent aussi le chemin bot soirées
- `DISCORD_THREAD_CLEANUP_ENABLED` + `DISCORD_THREAD_CLEANUP_MODE` : archivage/suppression des fils (dry-run sauf `execute`)
- `DISCORD_THREAD_CLOSE_ON_END_ENABLED` : archive le fil dès la fin (au lieu du cron suivant) ; exige aussi le nettoyage ci-dessus en `execute`
- `RETENTION_CLEANUP_ENABLED` + `RETENTION_CLEANUP_MODE` : purge de rétention (dry-run sauf `execute`)
- `STEAM_NOW_PLAYING_ENABLED` : indicateur « En jeu » sur `/potes` (un appel `GetPlayerSummaries` groupé dans `steam-library-sync`) ; exige la migration `steam_now_playing`
- `PAGE_TITLES_ENABLED` : titres d'onglet par page (gabarit `%s · GameNight`) ; éteint = titre global seul
- `GUIDE_V2_ENABLED` : sections « Jouer maintenant » et « Tournois » dans `/guide`
- `TOURNAMENT_SCORES_ENABLED` : saisie facultative des scores de match (bracket seulement, ni annonces ni MP) ; exige la migration `tournament_match_scores`
- `VOTE_VETO_ENABLED` : veto au vote de jeu (1 par personne et par soirée, remplaçable ; un jeu vetoé n'est ni retenu ni tiré ; veto refusé s'il ne reste aucun jeu candidat ; roulette asynchrone : 1 veto par participant tant que la soirée est à venir, relance sans les jeux vetoés, annonce éditée) ; exige les migrations `add_session_veto` et `add_roulette_veto`
- `ROULETTE_PLAYER_FILTER_ENABLED` : roulette (asynchrone et instantanée) : ne tire que les jeux qui acceptent le nombre de joueurs inscrits, repli sur toutes les entrées si aucune ne convient ; allume aussi « Relancer » sans doublon et « Recommencer » de la roulette instantanée ; sans migration

## Outils
- Superpowers : planifier une grosse fonctionnalité.
- Context7 : doc Next / Prisma / Auth.js (avant de se fier à la mémoire).
- Playwright : vérifier un parcours dans le navigateur.
- `/security-review` avant de merger du code sensible (auth, Discord, crons, secrets).
- Ponytail / Headroom / CodeBurn : économie et suivi des tokens.
- claude-code-setup : hooks et automatisations.
- claude-mem : mémoire persistante entre sessions, activée.
- Session cloud : un hook `SessionStart` (`.claude/hooks/session-start.mjs`) installe les dépendances si besoin, lance `prisma generate`, puis `prisma migrate deploy` sur un Postgres local (127.0.0.1 uniquement, jamais Neon).
- CI GitHub Actions (`.github/workflows/ci.yml`) : `test:postgres` (service Postgres du job, jamais Neon), `npm test`, `next typegen` + `tsc`, lint, build. Attendre le check vert (`verify`) avant de sortir une PR de Draft.
- Au début d'une tâche, annonce en une ligne quels outils tu vas utiliser et pourquoi.

## Style de réponse
Réponses courtes, en français. Pas de recap inutile ni de re-explication du diff.

## Garde-fous (`.claude/`)
Hooks : lecture/écriture `.env*` et commandes contenant `neon.tech` bloquées ; modification de migrations existantes bloquée ; `eslint --fix` auto sur le fichier édité.
