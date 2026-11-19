# GameNight

Application privée de soirées jeux, en français. Lire [README.md](README.md) pour le produit et la stack, [docs/INDEX.md](docs/INDEX.md) pour les guides, et [docs/REPRISE_AUTONOME.md](docs/REPRISE_AUTONOME.md) comme unique point de reprise actif.

Les états de lots, rapports et CODEX-PROGRESS datés sont historiques : ils sont archivés sous docs/archive/ et ne décrivent pas le statut courant.

## Stack
Next.js 16 (App Router) · React 19 · TypeScript · Prisma 6 · PostgreSQL (adaptateur Neon sur le chemin de déploiement) · Auth.js v5 (Discord OAuth) · Vercel · Vitest.

## Commandes
- `npm run lint` · `npx tsc --noEmit` · `npx next build` (`npm run build` = `prisma generate` + `next build` : aucune migration au build)
- `npx vitest run <fichier>` : tests unitaires ciblés
- Tests d'intégration : Postgres Docker local, jamais Neon. En session cloud, le hook SessionStart (`.claude/hooks/session-start.mjs`) fait les étapes 1-2 sans Docker (Postgres 16, 127.0.0.1:55439) et exporte `TEST_DATABASE_URL` : lancer directement l'étape 3.
  1. `docker run -d --name gamenight-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=gamenight_test -p 127.0.0.1:55439:5432 postgres:16-alpine -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c checkpoint_timeout=1h -c max_wal_size=8GB`
  2. `DATABASE_URL=<url ci-dessous> npx prisma migrate deploy`
  3. `TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_test npm run test:postgres`
- Vérifier le port libre (`netstat -ano | grep :55439`) et utiliser `127.0.0.1`, pas `localhost`.
- Pas de `.env` dans le repo (seulement `.env.example`) ; pas de python (utiliser node).

## Règles
- Jamais la base Neon en test ni en local. Tests uniquement via `TEST_DATABASE_URL`.
- Jamais de vraie notification Discord depuis un test ou un essai.
- PR en Draft ; s'arrêter à « PR ouverte, build vert » (check Vercel). Pas de merge/déploiement sans demande.
- Exception décidée par le propriétaire (2026-10-15) : la boucle roadmap (`scripts/work-roadmap.ps1`, suivi `docs/ROADMAP.md`) fusionne elle-même les PR `claude/lot[1-7]-*` qu'elle a construites, après la porte `scripts/roadmap-gate.mjs` et les contrôles `verify` et `Vercel` verts, puis attend le déploiement de production. Toute nouvelle migration est exclue de cette auto-fusion et exige une revue explicite. Claude ne fusionne jamais dans cette boucle : `gh pr merge` / `gh pr ready` lui restent interdits. Arrêt propre : fichier `logs/STOP`.
- Test « skipped » = à signaler explicitement, jamais présenté comme passé.
- Aucune nouvelle dépendance sans demander.
- Migrations Prisma existantes immuables (hook) : toujours en créer une nouvelle, additive (appliquée automatiquement après fusion dans main par `.github/workflows/migrate-production.yml`, jamais au build ; voir docs/MIGRATIONS.md). Changement Prisma seulement si justifié.
- Pas de refactor large, pas de try/catch silencieux.
- Commits/PR en français, style `type(scope): …`.

## Pièges appris
- Un fichier `"use server"` ne peut exporter que des fonctions async (sinon 500 sur toutes ses actions, invisible de tsc/lint/build) : gardé par `src/lib/use-server-exports.test.ts`.
- Base de test Docker (jetable, `127.0.0.1` uniquement) : démarrée avec `fsync=off` (voir la commande ci-dessus). Ces réglages suppriment la durabilité : un arrêt brutal du conteneur peut corrompre ou perdre la base, ce qui est acceptable car elle se recrée par `prisma migrate deploy`. Jamais sur Neon, Production ni une base à conserver; aucun réglage de Production n'est concerné. Sans cela, chaque `TRUNCATE … CASCADE` recrée les fichiers de ~100 tables et les checkpoints synchronisent 70 000 à 190 000 fichiers : des `TRUNCATE` de 7 à 23 s font expirer les hooks à 10 s, de façon intermittente et sur des fichiers différents (3 suites complètes aux délais d'origine : 16, 29 puis 38 tests en échec). Avec `fsync=off` : 347/347 fichiers, 3261/3261 tests, 283 s au lieu de 930–1222 s, mêmes délais.
- Les tests d'intégration partagent une base (TRUNCATE) : `npm run test:postgres` (un fichier à la fois), jamais deux runs en parallèle.
- Modèles collectifs : accès via le client scopé `scopedDb` (`getScopedPrisma(userId)`, `src/lib/community-scoped-client.ts`), jamais `prisma.<modèle>` directement dans le nouveau code (garde `src/lib/community-scope.test.ts`). Création = `communityId` scalaire obligatoire.
- `GameWishlist`, `GroupAchievement`, `GroupSessionStats`, `GroupGameStat`, `GroupActiveWeek` : `communityId` OBLIGATOIRE et dans la clé (PR9), jamais `null` : communauté par défaut = `getDefaultCommunityId()`, aussi isolation éteinte. Trophées annoncés sur Discord pour `default` seulement.
- `auth()` appelé depuis un composant serveur ou une server action jette les `Set-Cookie` : rien n'y est persisté dans le JWT (`src/auth.ts`).
- `/api/backfill/igdb-coop` accepte GET et POST (`Authorization: Bearer <CRON_SECRET>`) et répond 202 ; le traitement tourne dans `after()`.
- Les routes longues répondent 202 et travaillent dans after() quand leur code l’exige. Les routes et méthodes sont répertoriées dans docs/CRONS.md ; les cadences relèvent de la configuration externe.
- Connexion fermée par défaut (S0) : un compte sans Membership ACTIVE dans une communauté ACTIVE (`discordGuildId` dans sa liste OAuth `guilds`, REMOVED compris) est refusé, `AUTH_REQUIRE_GUILD_MEMBER` est sans effet ; les `ADMIN_DISCORD_IDS` peuvent ouvrir une session même sans Membership, sauf base indisponible. Cette exception de connexion n'accorde pas l'accès aux données collectives, qui exigent toujours une Membership (`src/auth.ts`, `src/lib/community-isolation.ts`).
- klipy : les liens de page (`klipy.com/…`) sont refusés, seuls les liens d'image (`static.klipy.com/…`) fonctionnent (`src/lib/banner-url.ts`).

## Notifications Discord
`enqueue` (`createNotificationEvent` + `enqueueDelivery`, `src/lib/notification-delivery.ts`) → lignes `NotificationEvent` / `NotificationDelivery` → executor (`src/lib/notification-executor.ts`, route cron `/api/cron/notification-executor`) qui réclame les livraisons (bail), résout le contenu puis appelle Discord (`discord-rest.ts`, `discord-dm.ts`). Les actions n'appellent pas Discord directement quand le chemin bot est actif. Avec `NOTIFICATION_EXECUTOR_ENABLED=true`, `enqueueDelivery` planifie l'executor via `after()` (`notification-executor-kick.ts`) ; le cron n'est que le filet (retries, éditions différées).

Règles de ping (#116) : le créateur reçoit les MP mais n'est jamais mentionné dans le fil.
- Soirée : création, changement de date, « Soirée validée », rappel = mention dans le fil ET MP. Modification/fin = annonce et MP d'invitation édités, jamais de nouveau MP. MP fermé : mention de secours pour le créateur seulement.
- Tournoi : création = mention dans le fil ET MP ; lancement/fin/annulation = MP d'invitation édité.
- Roulette : jamais de mention ; MP d'invitation édité à la fin, MP de rappel conservé.

## Switches d'environnement
- `TOWER_TEAM_DAILY_ENABLED` : attribution quotidienne des défis d'équipe par `GET /api/cron/tower-team-daily`, OFF par défaut ; exige aussi `TOWER_CHALLENGES_ENABLED`, les flags communautaires et `CRON_SECRET`. Preview bloquée ; horaire cible 18:00 Europe/Paris (décision du 17/11/2026), cadence externe à vérifier, aucun cron créé automatiquement.
- `TOWER_ONBOARDING_PANEL_ENABLED` : panneau Discord à trois boutons (joueurs, soirées, Ascension), OFF par défaut ; exige `TOWER_DISCORD_WELCOME_CHANNEL_ID` et `TOWER_DISCORD_GUILD_ID`. Publication uniquement par un workflow autorisé distinct, aucun auto-envoi ; Preview bloquée. Les réponses aux boutons restent privées et ne changent aucun rôle.
- `SESSION_CHRONICLES_ENABLED` : chronique texte des soirées DONE, éditée par le créateur et lisible selon l'accès privé à la soirée ; archive Lore paginée par serveur ; OFF par défaut, migration `session_chronicles`. Toute chronique non vide bloque la purge automatique même flag OFF ; suppression volontaire inchangée.
- `TOURNAMENT_PREDICTIONS_ENABLED` : pronostics immuables champion avant lancement et gagnant de match avant résultat ; membres actifs, sans mise ni gain XP ; OFF par défaut, migration `tournament_predictions`
- `COMMUNITY_QUICK_POLLS_ENABLED` : sondages éclair par serveur dans Profil → Lore, membres actifs même isolation OFF, 2–6 options immuables, un choix modifiable jusqu’à échéance (7 jours max), résultats agrégés ; aucune notification/XP ; migration `community_quick_polls`, OFF par défaut
- `COMMUNITY_GAME_GRAVEYARD_ENABLED` : cimetière et épitaphes des jeux par serveur dans Profil → Lore, sans retrait de bibliothèque ; lecture aux membres actifs, création/modification/retrait réservés aux ADMIN/OWNER communautaires, même pour l’auteur ; exige la migration `community_game_epitaphs` ; OFF par défaut
- `COMMUNITY_EXPRESSIONS_ENABLED` : collection d’expressions et running gags par serveur dans Profil → Lore ; lecture aux membres actifs, création/modification/suppression réservées aux ADMIN/OWNER communautaires, même pour l’auteur et isolation éteinte ; exige la migration `community_expressions` ; OFF par défaut

- `COMMUNITY_HIGHLIGHTS_ENABLED` : exploits/fails éditables par serveur, liens médias sans upload ; OFF par défaut, migration `community_highlights`.
- `PROFILE_VISIBILITY_ENABLED` : un membre peut masquer son profil (liste Potes et fiches `/potes/[id]/*`, via `canViewPote`) ; les soirées, classements et autres pages partagées ne changent pas ; sans ligne = visible ; migration `profile_visibility` ; OFF par défaut.
- `TEAM_APPLICATIONS_ENABLED` : candidatures d’équipe (message, acceptation/refus par le responsable, retrait par le candidat) sur `/equipes/candidatures` ; l’acceptation réutilise `joinCommunityTeam` ; exige aussi `communityTeamsEnabled` ; aucune notification ; OFF par défaut, migration `team_applications`.
- `DISCORD_TEAM_SPACES_ENABLED` : espaces Discord d’équipe — **option A du 18/11/2026** : salon textuel privé permanent **et** salon vocal privé permanent (type 2), tous deux privés (Voir les salons refusé à @everyone, autorisé au rôle d’équipe ; le rôle reçoit en plus Envoyer les messages et Lire l’historique sur le textuel, Connexion et Parler sur le vocal — jamais d’administration), plus un rôle sans permission (`DiscordTeamSpace`, jamais de suppression : archiver = renommer les deux salons). Aucune écriture directe : création d’équipe, `/projet espace`, `/equipe rejoindre`, `/projet rejoindre|quitter` et les actions web enfilent un `NotificationEvent` ADMIN de type TEAM_SPACE_SYNC (`discord-team-space-queue.ts`) exécuté par l’executor (action `sync_team_space`, `discord-team-space-runner.ts`). Exige aussi `NOTIFICATION_EXECUTOR_ENABLED`, le jeton du bot, `communityTeamsEnabled` et un serveur Discord relié. Quota produit `DISCORD_TEAM_SPACES_MAX_PER_COMMUNITY` (défaut 5, max 200) ; le planificateur refuse explicitement (`capacity`) au-delà des limites Discord officielles (500 salons, 250 rôles par serveur) et signale un seuil d’alerte à 80 %. OFF par défaut, migrations `20261118110000_discord_team_space` puis `20261118110100_discord_team_space_voice` (sans elles : `migration_required`, aucune écriture Discord).
- `DISCORD_PROJECT_COMMAND_ENABLED` · `DISCORD_PROJECT_WRITE_ENABLED` : `/projet` (`discord-project-command.ts`), façade sur les équipes de `/equipe` (mêmes services `community-teams`, 2 à 8 places, capitaine `captainId ?? createdById`, réponse via `runTeam`) ; la lecture (`liste`, `voir`) exige le premier, `creer|rejoindre|quitter|recrutement|espace` exigent aussi le second ; OFF par défaut, sans migration ; aucune commande n’est enregistrée automatiquement (manifeste `scripts/discord-commands.json`).
- `WEB_PUSH_ENABLED` + `WEB_PUSH_VAPID_SUBJECT` / `WEB_PUSH_VAPID_PUBLIC_KEY` / `WEB_PUSH_VAPID_PRIVATE_KEY` : Web Push uniquement après opt-in par appareil ; toutes les valeurs sont requises et le drapeau doit valoir `true`. Garder la clé privée dans l'environnement serveur, jamais dans le dépôt; migration `web_push_subscriptions`.
- `SESSION_PREPARATION_ENABLED` : checklist de préparation individuelle sur les soirées planifiées (installation, mise à jour, micro et lobby) ; désactivée par défaut
- `SESSION_VIDEO_ENABLED` : clips MP4 privés dans la galerie des soirées ; OFF par défaut, limite commune de 4 Mo et 8 médias, exige aussi `SESSION_MEDIA_BLOB_TOKEN` et l’activation de la galerie par communauté ; durée et codecs non garantis
- `VOICE_PRESENCE_ENABLED` : intervalles vocaux associés à une soirée configurée ; OFF par défaut, exige guild/salons/session explicites et décision de consentement/rétention (format `YYYYMMDD-identifiant`) avant toute collecte, bornée à 12 h après `Session.date` ; durées lisibles par le créateur et les admins invités seulement ; la purge de rétention tourne même drapeau éteint dès que les tables vocales existent ; 4 migrations vocales (`20261105131000`, `20261105132000`, `20261105133000`, `20261105134000`) non appliquées en Production : elles s'appliquent avec les 2 migrations XP (`20261105130000`, `20261105135000`) par une même exécution explicite de `scripts/db-migrate.mjs`, et AVANT le déploiement du code (la page détail d'une soirée et l'annulation/clôture interrogent les tables vocales) ; base indisponible : 7 échecs de découverte tolérés (le 8e est fatal) avec backoff plafonné à 300 s, puis sortie 1 (procédure : `docs/LIVRAISON-VOCAL.md`)
Tous OFF par défaut : actifs uniquement si la valeur vaut exactement `true` (`MODE=execute` pour les cleanups ; sinon dry-run). Routes `/api/cron/*` fail-closed : 503 sans `CRON_SECRET`.
- `NOTIFICATION_EXECUTOR_ENABLED` : sans lui l'executor ne réclame ni n'envoie rien (`{enabled:false}`)
- `GAME_PREPARATION_TIME_ENABLED` : affiche et autorise la saisie d'une durée estimée (1–10 080 minutes) sourcée sur la fiche jeu ; OFF par défaut
- `FREE_GAME_FEED_ENABLED` : ajoute au catalogue de jeux gratuits les offres GamerPower filtrées pour Steam/Epic ; attribution affichée, les conditions et la région restent à vérifier sur la boutique ; OFF par défaut, exige aussi `freeGamesEnabled` pour la communauté
- `DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED` : autorise l'ajout planifié des offres gratuites à l'outbox Discord ; OFF par défaut, exige aussi `FREE_GAME_FEED_ENABLED`, `COMMUNITY_CHANNELS_ENABLED`, `NOTIFICATION_EXECUTOR_ENABLED`, `freeGamesEnabled` et un salon communautaire dédié
- `WHO_PLAYS_TONIGHT_ENABLED` : page `/ce-soir` « Qui joue ce soir ? » : un membre se déclare dispo en un clic pour 1 à 3 jeux (petites annonces `PlayerClassified` au préfixe « 🟢 Dispo ce soir », échéance 4 h du matin, remplacées à chaque déclaration) et voit joueurs dispo par jeu, parties « Jouer maintenant » en cours et ses soirées visibles de ce soir ; sans migration, exige aussi `playerClassifiedsEnabled` ; aucune notification ; OFF par défaut (404)
- `CALENDAR_SUBSCRIPTIONS_ENABLED` : abonnement iCal privé et révocable par serveur depuis `/calendrier`; migration `calendar_feed_tokens`, membre et communauté ACTIVE requis à chaque lecture; OFF par défaut
- `TOWER_CHALLENGE_REPLACEMENT_ENABLED` : un joueur remplace une fois son défi solo en cours (à réaliser, non expiré) quand la définition exige un jeu absent de sa bibliothèque (`UserGame.owned`) ; défi équivalent du catalogue (même nombre d’étages), quota et échéance inchangés, journal `TowerChallengeReplacement` ; bouton sur `/tower` ; exige aussi `TOWER_CHALLENGES_ENABLED` ; aucune notification ; OFF par défaut, migration `tower_challenge_replacement`.
- `TOWER_IRREGULAR_GRANTS_ENABLED` : grade Irregular (prestige, aucun droit de modération, aucun rôle Discord) attribué ou retiré à la main par les OWNER/ADMIN de la communauté sur `/admin/tower-irregular`, journalisé ; lu par `getTowerPersonalProgress` (un grade gagné l’emporte) ; exige aussi `TOWER_CHALLENGES_ENABLED` ; aucune notification ; OFF par défaut, migration `tower_irregular_grants`.
- `TOWER_CHALLENGES_ENABLED` : active les parcours de défis uniquement avec le drapeau communautaire `towerChallengesEnabled`, membre actif et migration dédiée ; OFF par défaut. La clôture automatique réutilise le cron protégé `notification-executor`, dont la cadence reste externe. Activation en une soirée : docs/ACTIVATION_TOUR.md.
- `TOWER_DISCORD_ANNOUNCE_ENABLED` : verrou supplémentaire des annonces de preuve avec consentement et des réussites vers les salons configurés ; réutilise `NOTIFICATION_EXECUTOR_ENABLED` et la file existante. OFF par défaut.
- `TEAM_CAPTAIN_HANDOVER_ENABLED` + `TEAM_CAPTAIN_HANDOVER_MODE` : maintenance des capitaines inactifs 30 jours ; OFF par défaut et simulation tant que `MODE` n’est pas exactement `execute`. La route dédiée reste protégée par `CRON_SECRET` et refusée sur Preview.
- `TOWER_DISCORD_GUILD_ID` / `TOWER_DISCORD_CHANNEL_ID` / `TOWER_DISCORD_GENERAL_CHANNEL_ID` : identifiants de serveur, défis et annonces. Ne pas publier de valeurs de serveur dans `.env.example`.
- `SESSION_SERIES_CANCEL_ENABLED` : associe les nouvelles séries récurrentes et permet à leur créateur d’annuler les occurrences futures en vote/planifiées après confirmation; migration `recurring_session_cancellation`, anciennes séries indépendantes; OFF par défaut
- `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED` · `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED` : annonces soirées / tournois via le bot ; exigent aussi `DISCORD_BOT_GUILD_ID` et le salon (`…_SESSION_CHANNEL_ID` / `…_TOURNAMENT_CHANNEL_ID`)
- `DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED` : invitation « Jouer maintenant » par MP (aucun salon requis)
- `COMMUNITY_AUTO_CREATE_ENABLED` : création automatique de communautés PENDING (webhook d'événements Discord « application autorisée » + cron `community-guild-sync`) ; exige `DISCORD_APP_PUBLIC_KEY` (signature Ed25519 du webhook)
- `COMMUNITY_SETUP_COMMAND_ENABLED` : commande Discord `/gamenight setup` (permission « Gérer le serveur », endpoint `/api/discord/interactions`) qui active la communauté de son serveur sans validation manuelle ; exige `DISCORD_APP_PUBLIC_KEY` ; le PING de l'endpoint est acquitté même éteint
- `COMMUNITY_CHANNELS_ENABLED` : salons d'annonce par communauté (`CommunityChannelConfig`) pour soirées et tournois ; éteint = variables `DISCORD_BOT_*` seules, allumé = repli sur elles uniquement pour la communauté `default`
- `COMMUNITY_ISOLATION_ENABLED` active les filtres communautaires étendus ; la garde d’accès Membership aux données collectives de default reste appliquée même flag OFF après la correction #309. Suivre docs/COMMUNITY_ROLLOUT.md et docs/SECURITE_CLAUDE.md avant activation.
- `COMMUNITY_PICKER_ENABLED` : sélecteur de serveur `/serveurs` (0 serveur = message, 1 = redirection, plusieurs = choix) et porte sur accueil, `/sessions`, `/tournois`, `/classement` ; `User.activeCommunityId` est une préférence revalidée contre les Membership ACTIFS, jamais une autorisation ; exige la migration `add_user_active_community`
- `COMMUNITY_ADMIN_ENABLED` : onglet « Communautés » de `/admin` (admins) : activer une communauté PENDING et choisir ses salons SESSION / TOURNAMENT, vérifiés auprès de Discord ; sans migration ; les salons ne servent qu'avec `COMMUNITY_CHANNELS_ENABLED`
- `DISCORD_DM_SESSION_ENABLED` · `DISCORD_DM_TOURNAMENT_ENABLED` · `DISCORD_DM_ROULETTE_ENABLED` : création de nouveaux MP (les MP déjà en file sont traités) ; les MP de soirée exigent aussi le chemin bot soirées
- `ADMIN_DASHBOARD_V2_ENABLED` : tableau de bord staff `/admin/tableau-de-bord` (lecture seule, ADMIN seulement via `requireAdmin`, éteint = 404, sans migration, aucune écriture base ni Discord) : candidatures d’équipe PENDING, opérations Discord échouées (NotificationDelivery FAILED), espaces d’équipe archivés à nettoyer à la main, contestations Tower ouvertes, rôles et salons de chaque serveur contre les limites Discord 250 / 500 (alerte à 80 %, GET Discord en lecture seule) ; OFF par défaut (docs/ADMIN_TABLEAU_BORD.md)
- `DISCORD_ROLE_COMMAND_ENABLED` · `DISCORD_ROLE_SELF_CREATION_ENABLED` · `DISCORD_PROFILE_COMMAND_ENABLED` · `DISCORD_BOOSTER_ENABLED` : commandes Discord `/role`, `/profil` et `/boost` (déclaration séparée) ; `…_ROLE_SELF_CREATION` autorise un joueur sans « Gérer les rôles » à créer son rôle, jamais à modifier celui d'un autre ; aucune réponse publique, OFF par défaut
- `DISCORD_THREAD_CLEANUP_ENABLED` + `DISCORD_THREAD_CLEANUP_MODE` : archivage/suppression des fils (dry-run sauf `execute`)
- `DISCORD_THREAD_CLOSE_ON_END_ENABLED` : archive le fil dès la fin (au lieu du cron suivant) ; exige aussi le nettoyage ci-dessus en `execute`
- `RETENTION_CLEANUP_ENABLED` + `RETENTION_CLEANUP_MODE` : purge de rétention (dry-run sauf `execute`)
- `STEAM_NOW_PLAYING_ENABLED` : indicateur « En jeu » sur `/potes` (un appel `GetPlayerSummaries` groupé dans `steam-library-sync`) ; exige la migration `steam_now_playing`
- `PAGE_TITLES_ENABLED` : titres d'onglet par page (gabarit `%s · GameNight`) ; éteint = titre global seul
- `GUIDE_V2_ENABLED` : sections « Jouer maintenant » et « Tournois » dans `/guide`
- `TOURNAMENT_SCORES_ENABLED` : saisie facultative des scores de match (bracket seulement, ni annonces ni MP) ; exige la migration `tournament_match_scores`
- `VOTE_VETO_ENABLED` : veto au vote de jeu (1 par personne et par soirée, remplaçable ; un jeu vetoé n'est ni retenu ni tiré ; veto refusé s'il ne reste aucun jeu candidat ; roulette asynchrone : 1 veto par participant tant que la soirée est à venir, relance sans les jeux vetoés, annonce éditée) ; exige les migrations `add_session_veto` et `add_roulette_veto`
- `ROULETTE_PLAYER_FILTER_ENABLED` : roulette (asynchrone et instantanée) : ne tire que les jeux qui acceptent le nombre de joueurs inscrits, repli sur toutes les entrées si aucune ne convient ; allume aussi « Relancer » sans doublon et « Recommencer » de la roulette instantanée ; sans migration
- `MIGRATION_GATE_ENFORCE` : garde de build Production (`scripts/assert-migrations-applied.mjs`) ; exactement `true` = le build échoue si une migration du commit n'est pas appliquée (l'ancien déploiement reste servi), sinon mode rapport non bloquant ; lecture via `MIGRATION_GATE_DATABASE_URL` (rôle SELECT seul, recommandé) sinon `DATABASE_URL` ; à définir dans Vercel Production seulement, après lecture du rapport (docs/MIGRATIONS.md)
- `TOWER_DISCORD_PREFLIGHT_ENABLED` : `GET /api/admin/tower-preflight` (admins) : inventaire en lecture seule des salons du serveur `DISCORD_BOT_GUILD_ID` ; éteint = 404, jamais d’écriture Discord

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
