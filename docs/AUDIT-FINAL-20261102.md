# Audit final GameNight — 2 novembre 2026

**Verdict : pas fini**, si « fini » signifie : toutes les fonctions retenues du cahier des charges utilisables en Production, schéma cohérent, intégrations configurées et parcours critiques validés avec preuves.

Le socle est largement livré et sa CI est verte. Cela ne suffit pas à déclarer les activations, le vocal, la séparation XP ou les recettes réelles terminés.

## Périmètre et arrêt demandé

- Référence figée : `7f0dd053d3a9098735aeb8ee22d984170932238d` (main, squash de #346), arbre `e217dad7999909a7a200a39f0b63d89be74ed4f0`.
- Audit du code et des documents ; lectures GitHub, métadonnées Vercel sans déchiffrement, catalogues PostgreSQL et registre des migrations sur `br-super-cell-b1ukvk08` / `neondb`.
- Aucun test exécuté contre Production, aucune lecture de données métier, aucune migration, restauration, activation, modification de permissions ou fusion.
- Seule écriture distante demandée : ce document sur une branche et une PR brouillon séparées.
- **Arrêt des investigations à la découverte d’un écart confirmé** : index déclaré dans Prisma mais absent de la base et de la migration Tower. Aucun correctif exécuté. Cet audit constitue donc un état documenté, pas une certification exhaustive ni une revue de sécurité complète.
- **Prouvé** = source, catalogue ou log consulté dans cette session. **Supposé/non vérifié** = déduction, historique ou contrôle indisponible, explicitement signalé.
- « Livré en code » ne signifie pas « actif ». Tests présents ≠ recette réelle. Les chemins courts du tableau sont dans `src/lib/`, sauf mention contraire.

## 1. Tableau fonctionnel

Les états du code ci-dessous sont prouvés par lecture. L’exécution CI est attestée globalement en section 5 ; aucun taux de couverture par fonction n’est prétendu. Les flags « OFF » sont absents de la configuration projet Production relevée et exigent exactement `true` dans le code. L’environnement embarqué du déploiement n’a pas été extrait : leur état runtime est déduit de cette configuration, pas observé dans une requête fonctionnelle.

| Élément | État | Preuve | Bloquant ou non |
|---|---|---|---|
| Carnet : six identifiants, matériel, micro, plateformes | Livré en code ; accès réel non recetté | gaming-identifiers.ts ; player-equipment.ts + tests intégration | Non |
| Préférences/refus, bibliothèques communes, import Steam | Livré en code ; import réel non vérifié | game-preferences.ts ; game-suggestions.ts ; game-library.ts + intégration | Recette externe |
| Disponibilités et sondage → soirée | Livré en code | availability.ts ; session-availability-poll.ts + intégration | Non |
| Quiz de profil / équipes équilibrées | Quiz livré ; équilibrage par profil absent du tournoi examiné (tirage aléatoire) | game-style-quiz.ts ; tournaments.ts:265–285 | Oui pour la demande initiale |
| Avertissements, prix, téléchargement | Livré, informations manuelles/sourcées ; fraîcheur non garantie | game-warnings.ts ; game-preparation.ts + intégration | Non |
| Checklist et temps de préparation | Livré ; flags absents → OFF | session-preparation.ts ; SESSION_PREPARATION_ENABLED ; GAME_PREPARATION_TIME_ENABLED | Oui pour usage de ces fonctions |
| Lore : exploits/fails, expressions, chronique, cimetière | Livré ; quatre flags absents → OFF | community-highlights.ts ; community-expressions.ts ; session-chronicles.ts ; community-game-graveyard.ts | Activation/recette |
| Calendrier : anniversaires, sorties, dates gaming/saisons | Livré, partiel pour alimentation permanente : dates éditoriales bornées | community-dates.ts:34–58 ; calendar.ts ; wishlist/IGDB | Maintenance éditoriale |
| Rituels récurrents | Création hebdo/mensuelle livrée ; annulation groupée OFF ; édition groupée absente | app/sessions/actions/session-lifecycle.ts:96–168 ; session-recurrence.ts | Oui si édition groupée conservée au périmètre |
| Mini-jeux, quiz et devinettes | Livré en code, tests présents | community-game-quiz.ts et son test | Non |
| Sondages éclair et pronostics | Livré ; flags absents → OFF | community-quick-polls-input.ts ; tournament-predictions.ts + intégration | Activation/recette |
| Guide, charte et glossaire | Livré ; guide V2 OFF | app/guide/page.tsx ; app/charte/page.tsx ; fair-play-charter.ts | Non pour version de base |
| LFG petites annonces | MVP livré, expiration 24 h ; réglage communautaire non lu | player-classifieds.ts + intégration ; playerClassifiedsEnabled | Activation non vérifiée |
| Rappels Discord et RSVP | Code livré ; valeurs des flags existants et parcours réel non vérifiés | discord-session-rsvp.ts ; discord-tournament-rsvp.ts ; discord-instant-session-rsvp.ts | Recette réelle + rejeu instantané à traiter |
| Liste d’attente / remplaçants | Livré en code | session-seats.ts ; session-seat-plan.ts + intégration | Non |
| Vote/veto et roulette pondérée/filtre joueurs | Livré ; VOTE_VETO_ENABLED et ROULETTE_PLAYER_FILTER_ENABLED absents → OFF | roulette-veto.ts ; roulette-draw.ts + intégration | Activation/recette |
| Historique, statistiques et Wrapped | Mensuel livré ; annuel absent du code trouvé | profile-stats.ts ; monthly-recap.ts ; app/recap/[year]/[month]/page.tsx | Annuel = extension distincte |
| MVP multicatégorie, note de soirée | Livré en code | superlative-voting.ts ; app/sessions/actions/ratings.ts + tests | Non |
| Galerie photos / MP4 | Code livré ; SESSION_MEDIA_BLOB_TOKEN absent ; MP4 OFF | app/sessions/actions/gallery.ts ; session-gallery.ts + intégration | Oui pour galerie opérationnelle |
| Quêtes et saisons/reset | Livré en code ; usage réel non recetté | weekly-challenges.ts ; seasons.ts et tests | Recette |
| Présence, bonus/malus | Déclaratif livré ; présence vocale mesurée absente de main, proposée dans #325 | session-attendance.ts ; session-absence-xp.integration.test.ts ; #325 | Oui pour mesure réelle |
| Boutique, monnaie et grades | Boutique livrée mais dépense xpTotal ; séparation progression/solde non déployée | xp-shop.ts: getShopState/buyShopItem ; #325 | Oui pour modèle XP demandé |
| Promotions / achats collectifs | MVP Steam et coordination ; paiement et promotions Epic payantes non démontrés | ROADMAP L6-10/L6-11 ; code wishlist et achats collectifs | Décision de périmètre |
| Jeux gratuits et annonces Discord | Code livré ; FREE_GAME_FEED_ENABLED et DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED absents → OFF | free-game-discord.ts + intégration | Activation/recette |
| Tournois : équipes/bracket/scores/annonces | Livré ; scores OFF ; annonces réelles non vérifiées | tournaments.ts ; tournament-team-bracket.integration.test.ts ; tournament-scores.ts | Recette réelle |
| iCal / abonnement privé | Export livré ; CALENDAR_SUBSCRIPTIONS_ENABLED absent → abonnement OFF | ical-calendar.ts ; calendar-feed.integration.test.ts | Activation pour abonnement |
| Push mobile / rejoindre vocal | Push OFF et VAPID absents ; lien vocal en code, destination non vérifiée | web-push-config.ts ; ROADMAP L4-04 | Activation + appareils |
| Hors ligne | Partiel : page de secours, pas application privée hors connexion | public/offline.html ; ROADMAP L7-13 | Décision de périmètre |
| The Tower | Code livré ; toutes variables TOWER_* absentes → drapeaux OFF ; commandes enregistrées non inspectées | CLAUDE.md ; métadonnées Vercel sans valeurs | Oui pour Tour opérationnelle |

Références de suivi confrontées : [docs/ROADMAP.md](https://github.com/ZeyFro/gamenight/blob/7f0dd053d3a9098735aeb8ee22d984170932238d/docs/ROADMAP.md) ; [docs/REPRISE_AUTONOME.md](https://github.com/ZeyFro/gamenight/blob/7f0dd053d3a9098735aeb8ee22d984170932238d/docs/REPRISE_AUTONOME.md). **`docs/LIVRAISON-TABLEAU.md` est absent de ce main** ; le tableau cité par #325 appartient à sa branche, pas à la livraison actuelle. Le contenu de #325 n’a pas été modifié.

## 2. Base Neon

### Registre des migrations — prouvé

- **118 fichiers migration.sql dans main et 118 entrées en base** : aucun nom manquant, aucun nom en trop, aucune migration inachevée ou annulée au relevé.
- Checksums comparés au SHA256 des fichiers : tous correspondent à LF ou à CRLF. Les sept Tower correspondent à la version CRLF ; la différence de fins de ligne est identifiée, ce n’est pas une preuve de SQL différent.
- Les sept Tower enregistrées sont :
  1. `20261026180000_community_teams`
  2. `20261026190000_session_community_team`
  3. `20261026210000_tower_levels_per_floor`
  4. `20261026220000_community_team_game_restrict`
  5. `20261028140000_tower_challenges`
  6. `20261028230000_tower_season_vote`
  7. `20261029061000_tower_team_challenges`
- Les six migrations XP/vocal décrites dans #325 ne sont ni dans ce main ni dans les 118 entrées. Elles ne sont donc **pas des migrations manquantes de main** :
  `20261019190000_separate_xp_balance`,
  `20261020150000_session_voice_presence`,
  `20261022120000_voice_presence_consent_coordination`,
  `20261022130000_voice_presence_retention_gap_bounds`,
  `20261022140000_voice_presence_gap_history`,
  `20261022142500_shop_balance_purchase_reason`.
- Marqué applied ne prouve ni une sauvegarde restaurable ni la conformité de tous les effets de données historiques.

### Schéma — résultats et limite

Comparaison statique des 94 modèles, 746 champs scalaires, enums et catalogues :
- Aucun champ scalaire attendu manquant ; aucun écart de type détecté sur les types standards contrôlés ; aucune valeur enum attendue manquante ou supplémentaire.
- Les vues d’extension `pg_stat_statements`/`pg_stat_statements_info` et la table de démonstration `playing_with_neon` sont hors modèles applicatifs. Aucune donnée de ces objets n’a été lue.
- Les noms des 190 clés étrangères extraites des relations Prisma sont présents. **Cela ne certifie pas toutes leurs actions de suppression, leurs valeurs par défaut ni toutes les expressions CHECK**.
- **Écart confirmé** : [prisma/schema.prisma](https://github.com/ZeyFro/gamenight/blob/7f0dd053d3a9098735aeb8ee22d984170932238d/prisma/schema.prisma) déclare `@@index([attemptId, communityId])` dans `TowerChallengeAttemptParticipant`. Aucun index correspondant dans `pg_indexes`. [prisma/migrations/20261029061000_tower_team_challenges/migration.sql](https://github.com/ZeyFro/gamenight/blob/7f0dd053d3a9098735aeb8ee22d984170932238d/prisma/migrations/20261029061000_tower_team_challenges/migration.sql) ne le crée pas non plus. Le PK existant est `(attemptId,userId)` : ce n’est pas le même index. Impact performance/intégrité du plan de migration à analyser ; aucune panne reproduite.
- Sept colonnes tableaux sont physiquement nullables (`User.preferredGameCategories/refusedGameCategories/inputDevices/availablePlatforms`, `Session.reminderTimings`, `MessageTemplate.categories/variables`). Les migrations les créent ainsi ; cette observation seule n’est pas qualifiée de dérive Prisma ni d’erreur de données.
- **Index unique NotificationEvent confirmé physiquement** : `NotificationEvent_category_eventType_sourceId_occurrence_key`, colonnes `category,eventType,sourceId,occurrence`. L’hypothèse « index unique absent » est réfutée.
- Pas de `prisma migrate diff` connecté ni de base shadow créée ; comparaison complète équivalente au moteur Prisma **non effectuée**. Ne pas conclure « aucune dérive ».

### Sauvegardes et branches — prouvé par métadonnées

- Snapshot `prod-avant-tower-migrations-20261102`, ID `snap-gentle-queen-b1sg18j2`, source Production, créé le **2 novembre à 18:36:06 heure de Paris**. Présent et métadonnées lisibles ; restauration non testée dans cet audit.
- `preview-tower-20261030` et `preview-tower-v2-20261030` absentes de la liste actuelle.
- `backup-avant-tower-migrations-20261030` (`br-old-hat-b11o5wof`) présent.
- Huit branches Neon restantes : Production, portable1-recette-20261019, tower329-isolated-snapshot-20261020, backup-avant-tower-migrations-20261030, xp291-restored-proof-20261020, xp291-endpoint-repair-20261020, preview-gamenight, backup-avant-multiserveur. Aucune suppression effectuée.
- Rôles LOGIN observés : `cloud_admin`, `neon_service`, `neondb_owner`. Aucun rôle runtime/migration distinct visible ; `neondb_owner` possède CREATEROLE/BYPASSRLS. Les rôles plateforme ne sont pas assimilés à des writers applicatifs.

## 3. Déploiement et configuration

**Prouvé par Vercel** :
- Production `dpl_s9hE4DBXGXbvdBqPekQbMnESyfMT`, `READY`, commit `7f0dd053d3a9098735aeb8ee22d984170932238d`.
- Alias `gamenight-zeyfro.vercel.app` associé à ce déploiement, `aliasError=null`.
- Recherche `get_runtime_errors(since=24h)` : **aucune erreur retournée**. Ce résultat agrégé ne certifie ni l’exhaustivité/rétention des logs, ni l’absence de HTTP 4xx/5xx, ni le succès de chaque fonctionnalité.
- Les métadonnées de variables sont accessibles ici ; l’ancien blocage 403 n’est pas reproduit sur ces lectures. Aucune valeur sensible demandée/déchiffrée.
- Noms seulement, 36 variables ciblant Production :
  `ADMIN_DISCORD_IDS`, `AUTH_REQUIRE_GUILD_MEMBER`, `AUTH_SECRET`, `AUTH_URL`, `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY`, `COMMUNITY_AUTO_CREATE_ENABLED`, `COMMUNITY_CHANNELS_ENABLED`, `COMMUNITY_ISOLATION_ENABLED`, `COMMUNITY_PICKER_ENABLED`, `COMMUNITY_SETUP_COMMAND_ENABLED`, `CRON_SECRET`, `DATABASE_URL`, `DEEPL_API_KEY`, `DISCORD_APP_PUBLIC_KEY`, `DISCORD_BOT_GUILD_ID`, `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`, `DISCORD_BOT_SESSION_CHANNEL_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED`, `DISCORD_BOT_TOURNAMENT_CHANNEL_ID`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_DM_ROULETTE_ENABLED`, `DISCORD_DM_SESSION_ENABLED`, `DISCORD_DM_TOURNAMENT_ENABLED`, `DISCORD_THREAD_CLEANUP_ENABLED`, `DISCORD_THREAD_CLEANUP_MODE`, `DISCORD_THREAD_CLOSE_ON_END_ENABLED`, `DISCORD_WEBHOOK_URL`, `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, `NOTIFICATION_EXECUTOR_ENABLED`, `STEAM_API_KEY`, `STEAM_NOW_PLAYING_ENABLED`.

**Configuration incomplète prouvée par noms** :
- Aucune variable `TOWER_*` : Tour OFF selon les gardes du code.
- Absents : `FREE_GAME_FEED_ENABLED`, `DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED`, `WEB_PUSH_ENABLED` et les trois `WEB_PUSH_VAPID_*`, `SESSION_MEDIA_BLOB_TOKEN`, `SESSION_VIDEO_ENABLED`, `CALENDAR_SUBSCRIPTIONS_ENABLED`, `VOTE_VETO_ENABLED`, `ROULETTE_PLAYER_FILTER_ENABLED` et les flags Lore/préparation cités plus haut : fonctions correspondantes indisponibles/OFF selon leur garde.
- **`DISCORD_TOKEN_ENCRYPTION_KEY` absente** alors qu’elle est documentée dans `.env.example` et requise par `discord-token-crypto.ts`. `auth.ts:158–171` abandonne la persistance des jetons avec avertissement ; `discord-profile.ts:151–175` passe au repli bot. La connexion n’est pas nécessairement bloquée, mais le chemin OAuth de conservation/rafraîchissement chiffré est incomplet si aucune autre injection d’environnement n’existe. Valeur/validité du secret non inspectées.
- La présence des flags Discord/executor dans les métadonnées **ne prouve pas qu’ils valent true**. Ne pas les déclarer actifs.
- `AUTH_REQUIRE_GUILD_MEMBER` reste configuré mais `CLAUDE.md` le décrit sans effet après S0.
- Variables Preview spécifiques à la branche `preview-tower` encore présentes (AUTH_URL, AUTH_SECRET, DATABASE_URL). Destination de la connexion non lue ; leur éventuel lien avec les branches Neon supprimées est **non vérifié**, aucun nettoyage proposé sans contrôle.
- Les gardes de cohérence `.env.example` ↔ code sont dans la CI ; elles ne prouvent pas qu’un secret requis est provisionné en Production.

Le build [scripts/build.mjs](https://github.com/ZeyFro/gamenight/blob/7f0dd053d3a9098735aeb8ee22d984170932238d/scripts/build.mjs) ne lance aucune migration. La destination réelle de DATABASE_URL n’est pas déduite du commentaire de variable ni du nom de branche Neon.

## 4. Bot, Discord et crons

| Élément | État prouvé par code/catalogue | Limite / blocage |
|---|---|---|
| Signature | Ed25519 timestamp + corps brut, refus sans clé/invalide ; fenêtre ±300 s | Pas de requête réelle envoyée |
| Acquittement | Réponse privée différée type 5 avant traitement SQL via after() | Latence réelle non mesurée |
| Mentions | parse:[] et utilisateurs explicites bornés ; réponses privées sans parse automatique | Pas de publication réelle |
| postToDiscord 429 | Retry-After numérique, repli retry_after, résultat rate_limited/retryAfterMs, pas de boucle ; timeout 10 s | Correctif #343 présent ; pas d’incident réel reproduit |
| NotificationEvent | Unique en code et en base ; création anti-doublon | Pas d’affirmation de livraison exactement une fois côté Discord |
| RSVP soirée | Déduplication durable par interactionId | Tests présents et CI verte |
| RSVP tournoi | Verrou FOR UPDATE et inscription déjà existante protégés ; pas de reçu durable interactionId | Rejeu après changement d’état non testé réellement |
| RSVP instantané | Join/leave protègent présence ouverte ; interactionId non transmis | Lacune de déduplication prouvée ; join→leave→rejeu pouvant rejoindre à nouveau = scénario déduit, non reproduit |
| Catches Tower | Journalisation des deux chemins métier dans #346 | Catches vides d’outillage/UI à qualifier séparément |

Sources : `discord-signature.ts`, `discord-interactions.ts:81–154`, `app/api/discord/interactions/route.ts`, `discord.ts:56–114`, `notification-delivery.ts:194–223`, `session-seats.ts:67–71`, `discord-tournament-rsvp.ts`, `tournament-registration.ts:12–34`, `discord-instant-session-rsvp.ts:35`, `instant-sessions.ts:220–294`.

**Il existe 11 routes cron, pas 12** ; [docs/CRONS.md](https://github.com/ZeyFro/gamenight/blob/7f0dd053d3a9098735aeb8ee22d984170932238d/docs/CRONS.md) concorde :
- Réponse asynchrone 202 / after() : notification-executor, retention-cleanup, refresh-discord-profiles, steam-library-full-sync.
- Synchrones : close-sessions, community-guild-sync, discord-thread-cleanup, free-game-discord, monthly-tasks, reminders, steam-library-sync.
- Les 11 utilisent `verifyCronRequest` : 503 sans CRON_SECRET, 401 si incorrect, comparaison à temps constant après hash.
- Certaines boucles synchrones n’ont pas de budget global (`close-sessions/route.ts:83–99`, `reminders/route.ts:143`). Un `maxDuration=60` n’assure pas une réponse en moins de 30 s.
- **Risque sous charge**, pas dépassement mesuré : si le déclencheur cron-job.org coupe effectivement à 30 s, ces routes peuvent perdre l’acquittement. Sa configuration réelle n’a pas été lue. after() reste soumis à la durée plateforme et n’est pas une file durable.
- Catches vides dans `scripts/work-roadmap.ps1` et certains traitements audio ; le catch tardif de `discord-rest.ts` après timeout et le parsing d’URL invalide sont intentionnels. Un scan de catches n’est pas une liste automatique de bugs.

**Discord réel non vérifié** : aucun connecteur Discord disponible dans cette session, aucun jeton récupéré, aucune commande enregistrée ni permission inspectée. L’absence actuelle de /tower et /tower-admin, les permissions Blacklist et la suppression du tournoi Casino schedule restent des informations fournies par Maxime/Claude, non confirmées indépendamment ici.

## 5. Tests et qualité

Preuve : [CI #346, run 41500770666](https://github.com/ZeyFro/gamenight/actions/runs/41500770666), job verify `125467351063`, tête `a8cd1e059bb9b93947f84484988423355b3487f5`.

- Arbre Git de la tête testée = arbre du squash main : `e217dad7999909a7a200a39f0b63d89be74ed4f0`. Le SHA est différent mais **les fichiers sont identiques**.
- PostgreSQL de service CI : **380 fichiers / 3 479 tests passés, aucun sauté dans cette exécution**, 557,10 s.
- npm test sans base : **292 fichiers passés, 88 fichiers sautés ; 2 297 tests passés, 1 179 sautés**. Les intégrations sont volontairement conditionnées à TEST_DATABASE_URL ; ce second run ne les valide pas à nouveau.
- generate, migrations sur base de service, typegen, TypeScript, lint et build : étapes success.
- Pas de run CI sur push main : le workflow CI est déclenché par pull_request. Les check-runs du squash main sont vides ; ne pas inventer un run verify sur ce SHA.
- Couverture utile présente : isolation communautaire, droits, transactions, files de notifications, votes/veto, boutique, concurrence des sièges. Les RSVP Discord tournoi/instantané sont largement mockés ; leurs tests ne prouvent pas les effets d’un rejeu complet.
- Pas de rapport de couverture instrumentée consulté : aucun pourcentage annoncé.
- Ni suite locale relancée ni recette navigateur/Discord/appareils exécutée dans cet audit. Une CI verte n’est pas une preuve de conformité Production.

## 6. Documentation contradictoire ou historique

- `docs/LIVRAISON-TABLEAU.md` absent de main ; #325 en parle depuis une autre branche.
- `docs/REPRISE_AUTONOME.md` dit encore main a8242ee, 111 migrations et Preview présentes : relevés historiques désormais dépassés.
- ROADMAP L6-12 affirme publication Discord gratuite absente, mais `free-game-discord.ts` et ses tests existent. Il manque l’activation, pas tout le code.
- ROADMAP L5-05 dit boutique terminée sans expliciter que main dépense la progression xpTotal ; #325 sépare le solde.
- Quiz de style livré ne signifie pas équipes équilibrées par profil.
- `docs/backlog-auto.md` (4 octobre) conserve des « À faire / Draft » historiques et mentionne migration au build ; cela contredit le build actuel.
- `.github/workflows/ci.yml` garde aussi un commentaire prétendant que npm run build migrerait, alors que le script ne le fait plus.
- Dates Game Awards et soldes du calendrier bornées : prévoir une maintenance de contenu. Wrapped annuel, paiement et hors-ligne complet ne doivent pas être glissés dans « livré ».
- Aucun de ces documents n’a été corrigé dans cette PR d’audit.

## 7. PR et branches ouvertes

**Avant création de cette PR**, la liste GitHub complète retourne une seule PR ouverte :
- **#325**, Draft, tête `ea78a86e194f6e834b133ec772b8d8809ebe8801`, branche `integ/xp-vocal-20261023`. Six migrations, runtime XP nouveau, worker vocal ; **ne pas fusionner**. Les preuves anciennes de sa description ne valent pas CI fraîche sur le main audité. Compatibilité de fusion actuelle non recalculée dans cet audit.
- #339 à #345 sont dans l’historique de main ; #346 est fusionnée à `7f0dd05`. #291/#303/#319/#324 ne figurent pas dans les PR ouvertes : ne pas demander de les fusionner à nouveau. Leurs branches restent présentes.
- **282 branches distantes** retournées en trois pages, aucune supprimée. Inventaire ci-dessous ; présence d’une branche ≠ travail restant ni nécessité de suppression. Après squash, ne pas confondre absence d’ascendance et travail non livré.
- À fusionner éventuellement : uniquement des lots explicitement revus/validés, hors mandat. À fermer : aucune autre PR ouverte identifiée ; cette PR d’audit doit rester Draft. À supprimer : aucune branche déclarée supprimable sans revue des travaux uniques et décision distincte.

<details>
<summary>Inventaire des 282 branches GitHub (nom et SHA court, au relevé)</summary>

- `a11y-focus-noms-cibles-tactiles` — `9a745b30e367`
- `access-secrets-hardening` — `e504e6f881ab`
- `atomicity-seasons-tournaments` — `04f162eadc1b`
- `audit/the-tower-discord` — `33e3682a2fa5`
- `bugfix-discord-avatars-gifs` — `53cec06c7b2e`
- `build-seed-reconciliation` — `9135dd68739e`
- `chiffrement-tokens-discord` — `d5714147d2e5`
- `chore/a11y-perf` — `1028f0a2761f`
- `chore/ci-github-actions` — `dbb473b0f8bd`
- `chore/cloud-session-start` — `d14278039eba`
- `chore/deploiement-migration-separee` — `956281c1980d`
- `chore/env-example` — `e2f8eeb282b7`
- `chore/migration-alignement-schema` — `763a821da66a`
- `chore/npm-audit-fixes` — `23983acfcce9`
- `chore/qualite-lint-ts` — `3fcd7a0d88b4`
- `chore/roadmap-autonome` — `9d7a4f8e9d3d`
- `chore/roadmap-fusion-auto` — `a146621b2639`
- `chore/xp-balance-bascule` — `b1d85aa6380e`
- `ci/postgres-miroir-ecr` — `7658f28e559e`
- `ci/pr-empilees` — `a38fdf6251b9`
- `claude/admin-xp-correction` — `8d62bf32ff89`
- `claude/csp-report` — `922dfad292f3`
- `claude/executor-event-driven` — `12eccdbe766e`
- `claude/fix-badge-motion-server-component` — `c8d45cdd3112`
- `claude/fix-reminders-voting` — `4384bd7e7668`
- `claude/gamenight-claude-md-hooks` — `75fe099ef1e5`
- `claude/gamenight-diag-notifs-ping` — `7ff267a6058f`
- `claude/gamenight-discord-thread-cleanup` — `b73a535d732c`
- `claude/gamenight-fix-force-relogin-api-routes` — `336b6ae351ce`
- `claude/gamenight-fix-reminders-burst` — `e8cb7dda4bf0`
- `claude/gamenight-fix-roulette-announce-via-bot` — `1c3865f07cab`
- `claude/gamenight-force-relogin-proof` — `69d03f746efe`
- `claude/gamenight-igdb-backfill` — `7dfd60274ccd`
- `claude/gamenight-jouer-maintenant` — `8ecbe22bb39e`
- `claude/gamenight-jouer-maintenant-500` — `073d03e85301`
- `claude/gamenight-nextauth-discord-umrtcr` — `865196e0242c`
- `claude/gamenight-notification-executor` — `187e7b224938`
- `claude/gamenight-ping-rules` — `5dcecca5a11a`
- `claude/gamenight-private-sessions` — `04e72a689905`
- `claude/gamenight-session-announce-threads` — `ac5bcf5ebb9b`
- `claude/gamenight-session-dm` — `9297edd9cbac`
- `claude/gamenight-session-roulette-inline` — `a6fc8714e438`
- `claude/gamenight-stabilisation` — `9f061cbc6249`
- `claude/gamenight-tournament-announce-threads` — `b32dd28dcda1`
- `claude/gamenight-tournament-roulette-dm` — `186025b23675`
- `claude/gamenight-tournament-v2` — `9e379a7cf674`
- `claude/gamenight-v2-cleanup-lifecycle` — `219f426127f2`
- `claude/gamenight-v2-fixes` — `a37754b5aa17`
- `claude/lien-evitement` — `8ac25df47b2c`
- `claude/readme-crons-pause` — `518ebd9535e0`
- `claude/relaxed-volta-apx0pv` — `65e20d21c764`
- `claude/s0-login-fail-closed` — `fea5906d68d2`
- `claude/steam-activite-recente` — `39b9899c6093`
- `claude/steam-cron-lightweight` — `d6e11ac21946`
- `claude/test-after-maxduration` — `f63cf4e24eb3`
- `claude/test-cron-auth-garde-fou` — `63ad277eecf6`
- `claude/test-env-flags-off` — `2ae840ce0fad`
- `claude/test-env-switches` — `26d86ff3396a`
- `claude/test-flags-claude-md` — `063b56644b2a`
- `claude/test-migrations-additives` — `1002403b5728`
- `claude/test-next-public-env` — `670154556180`
- `claude/test-no-console-log` — `063b56644b2a`
- `claude/test-no-dangerous-html` — `8d1603666ca9`
- `claude/test-no-while-in-view` — `c511e67d9077`
- `claude/test-pages-titre` — `2de642a5857f`
- `claude/test-pas-de-console-log` — `740df7a02d57`
- `claude/test-pas-de-neon-en-dur` — `365b0fa84855`
- `claude/test-pas-de-only` — `3d4195acb39f`
- `claude/test-readme-cron-methodes` — `41d3e06292b7`
- `claude/test-routes-api-auth` — `427292db5a75`
- `claude/tests-lib-sans-test` — `223c588de631`
- `claude/tests-regroupes` — `98472dec7b71`
- `claude/tournoi-game-selector` — `6e8250b7a373`
- `codex/browser-bracket-recipe-20261020` — `5b1bc3488abc`
- `codex/calendar-mobile-audit-20261020` — `7309896a4f69`
- `codex/community-domaines-pr-a` — `50240fa02c90`
- `codex/docs-security-reconciliation-20261021` — `6bddac49b42c`
- `codex/fix-source-map-js-1.2.2` — `4714e72e2d1e`
- `codex/fixe2-browser-20261020` — `870f8f5cd8e5`
- `codex/fixe2-coord-20261020` — `700cedbcb0d7`
- `codex/fixe2-discord-20261020` — `15938df7a70f`
- `codex/fixe2-review-20261020` — `6c0ca3ddbc46`
- `codex/fixe2-scope-20261020` — `2390505c68be`
- `codex/fixe2-steam-calendar-20261020` — `0523c70da043`
- `codex/fixe2-voice-20261020` — `b0b9e309a870`
- `codex/fixe2-xp-20261020` — `fa8016a6e566`
- `codex/free-games-discord-20261020` — `6dcf2a30a0c0`
- `codex/mvp-finalize-idempotency-20261020` — `6a0551c27d73`
- `codex/mvp-multicategory-tests-20261020` — `21b822945b6f`
- `codex/reprise-point-20261022` — `68bb81caeb8e`
- `codex/security-309-race-reconciliation-20261021` — `fa9422de3683`
- `codex/tournament-team-bracket-20261020` — `0aabef364387`
- `codex/tower-coordinator` — `730291ba19c6`
- `codex/tower-defis-regles` — `883dd67fbd08`
- `codex/tower-postgres-integration-20261031` — `893e5861cdf1`
- `codex/verifie-acces-depot-prive-gamenight` — `0f04cda9d383`
- `codex/veto-ui-fix-20261020` — `1badcbe7c2c4`
- `codex/voice-gateway-20261020` — `1ac6e8c81399`
- `codex/voice-gateway-build-20261020` — `59b8cea86c67`
- `codex/xp-balance-separation-20261019` — `8c56f4993544`
- `docs/backlog-auto` — `ffc322ed388b`
- `docs/claude-md-build-sans-migration` — `50fb6e0ca30d`
- `docs/claude-md-maj` — `843af26c380a`
- `docs/claude-md-outils` — `367e6f964c8c`
- `docs/crons-planifies` — `91fef020256d`
- `docs/env-final` — `da10cc7bcab0`
- `docs/final-readiness-audit` — `dfdb7f00175f`
- `docs/mission-checkpoint-20261019` — `0c77aeb4d6c4`
- `docs/mission-reprise-20261020` — `cd79c6f0225f`
- `docs/mission-reprise-latest-20261020` — `e0ee0915c4ef`
- `docs/rapport-csp-bloquant` — `eace9b42b166`
- `docs/readme-public` — `9ac43644f3af`
- `docs/reprise-checkpoint` — `60f89073ebd0`
- `docs/reprise-et-postgres-test` — `edf4506e5b1a`
- `docs/reprise-pc-273` — `b1dc425f6412`
- `docs/reprise-portable1` — `0b473353d383`
- `docs/reprise-verifiee-20261102` — `cb105c248138`
- `docs/scope-reconciliation-20261019` — `047601fd29a6`
- `docs/v2-final` — `1c3d052de194`
- `durcissement-bannieres-profil` — `9ef749fb7282`
- `feat/accueil-session-instantanee` — `13a69dbb982d`
- `feat/accueil-v2` — `1427bc6f0233`
- `feat/accueil-vivant` — `6b9416682cb8`
- `feat/api-health` — `f5039fc34ff6`
- `feat/auth-multi-guild-signin` — `619f8319f1aa`
- `feat/avertissements-jeux` — `caa90e93cfd7`
- `feat/calendar-subscriptions` — `ad34a3dcf056`
- `feat/cancel-recurring-sessions` — `2603ce080539`
- `feat/charte-fair-play` — `7da11baebd09`
- `feat/checklist-preparation` — `5633965e240a`
- `feat/classements-fun` — `40ebcad5add6`
- `feat/communautes-admin` — `40bd3f4642c9`
- `feat/communautes-bibliotheque-stats` — `30e9d4cf5caf`
- `feat/communautes-chat-dettes-accueil` — `06e302e60147`
- `feat/communautes-client-scope` — `8422fd43d0a2`
- `feat/communautes-creation-auto` — `ade8a2fb29dd`
- `feat/communautes-fondations` — `cda1f10cb51d`
- `feat/communautes-isolation` — `eff5e107cc92`
- `feat/communautes-progression-pr-b` — `3075adfe2518`
- `feat/communautes-salons` — `207615a68dc6`
- `feat/communautes-selecteur` — `a212f58cc256`
- `feat/community-expressions-next` — `1d9890c30d34`
- `feat/community-graveyard-next` — `1e6956161b81`
- `feat/community-guide-per-community` — `a7456b132557`
- `feat/community-highlights-next` — `1e6ef045b20c`
- `feat/community-oauth-rollout` — `1a5b9d1ea339`
- `feat/community-quick-polls-next` — `483f223b9741`
- `feat/csp-report` — `2695d113b41c`
- `feat/design-command-center` — `d44cf196af0e`
- `feat/discord-interactions-setup` — `f538f1b4899d`
- `feat/discord-je-viens-next` — `4e26e7b524f1`
- `feat/discord-reponses-soirees` — `7f238176e9a5`
- `feat/free-game-feed-20261019` — `019e9fef8ab4`
- `feat/glossaire-debutants-next` — `1bd14e0bda4b`
- `feat/heures-par-jeu` — `eadb69df2f74`
- `feat/identifiants-plateformes` — `db93b1073260`
- `feat/installation-multiserveurs` — `3463b8fa3ee1`
- `feat/jeux-communs-participants` — `2486f6d2d794`
- `feat/lien-evitement` — `c01181814e8b`
- `feat/liste-attente-soirees` — `1c7639da931c`
- `feat/materiel-joueurs` — `04150c1f14c5`
- `feat/organisation-quick-wins` — `85edd3993f36`
- `feat/potes-en-jeu-maintenant` — `9c58c8e33251`
- `feat/preferences-suggestions-jeux` — `126cb8652580`
- `feat/prix-telechargement-jeux` — `81810bc8fe19`
- `feat/promotion-waitlist-discord` — `0a72de55839d`
- `feat/pwa-hors-ligne-next` — `12e203ac8a40`
- `feat/quiz-profils-equipes` — `2f1057b80731`
- `feat/refonte-interface-gamenight` — `fce0cc968550`
- `feat/roadmap-product-basics` — `a2d5e6d64eee`
- `feat/robots-disallow` — `a09cf1fd1e7d`
- `feat/roulette-ponderee` — `a5472aca28c6`
- `feat/seasonal-calendar-20261019` — `7cb94456a3af`
- `feat/session-chronicles-next` — `fbaa83049743`
- `feat/session-rating` — `eb89435f1127`
- `feat/session-video-clips` — `d227144407b4`
- `feat/soldes-evenements` — `967845713616`
- `feat/sondages-disponibilites` — `4bbf1e009fb2`
- `feat/sorties-jeux-attendus` — `9559305fcf2e`
- `feat/steam-import-batch` — `468b8bb49ad5`
- `feat/suggestion-creneaux` — `5acf3a34fcdf`
- `feat/temps-preparation` — `045ab4d48bc9`
- `feat/the-tower-approved-layout` — `fb6802d71a36`
- `feat/themes-saisonniers` — `1fc076fbf53c`
- `feat/thread-cleanup-on-close` — `ec4a75a8ac9e`
- `feat/titres-de-page` — `3206285a6489`
- `feat/titres-dynamiques` — `00f50acb8e06`
- `feat/tournament-match-announcements` — `dcf74ad16532`
- `feat/tournament-prediction-points-20261019` — `a7487ea87c48`
- `feat/tournament-predictions-next` — `9829ec28f7d0`
- `feat/tournois-scores` — `c9617362c573`
- `feat/tower-content-audit` — `b9ef1a844f6b`
- `feat/tower-discord-provision-production` — `58a51088bdcf`
- `feat/tower-safe-archive` — `e68817eefbee`
- `feat/weekly-quests` — `2abce32dcac2`
- `feature-improvements-pr-a` — `102a9baf9c72`
- `feature-improvements-pr-b` — `97b5daca1111`
- `fix/accueil-v2-garde-fou` — `b6c0caa57196`
- `fix/backfill-igdb-coop` — `0efcaf76ec2c`
- `fix/bibliotheque-communaute-active` — `fc8e3c26f754`
- `fix/ci-postgres-image` — `e9bb4013f30f`
- `fix/community-scope-isolation-20261019` — `d3e8e7c25e58`
- `fix/cron-after-20261026` — `3be25826fed5`
- `fix/crons-longs-202-after` — `19e70628ded9`
- `fix/discord-oauth-issuer` — `d8a15eb16744`
- `fix/discord-webhook-429-20261102` — `711ae5e7c5fc`
- `fix/force-relogin-temps-constant` — `c3f8900d7c15`
- `fix/free-games-expiry-guard-20261020` — `22d4a09b47bf`
- `fix/gifs-klipy-repli` — `9914055d7a68`
- `fix/igdb-backfill-polish` — `214cda09df66`
- `fix/igdb-search-garde-fous` — `aca64ed5cd22`
- `fix/instant-session-invite-500` — `812a3ba9cc8b`
- `fix/interface-calendrier-mobile` — `2d1a72946fb9`
- `fix/log-erreurs-tower` — `a8cd1e059bb9`
- `fix/main-tests-verts` — `4d740d9c8723`
- `fix/offline-recipe-20261026` — `cbe20ed465f6`
- `fix/phase4-avatar-gif-steam` — `ca3674ab5546`
- `fix/potes-activite-steam-repli` — `2fa47590656e`
- `fix/rappels-apres-replanification` — `879707d2ef24`
- `fix/recette-locale-authentifiee` — `13a087d3b6cd`
- `fix/securite-durcissement` — `ec883c046c69`
- `fix/securite-porte-discord-profil` — `3c2efc7b939d`
- `fix/tests-session-announce-date-relative` — `b2be7c338640`
- `fix/tests-session-dates-relatives` — `c9b2480dcf19`
- `fix/tower-archive-verify-private-before-move` — `41699571989c`
- `fix/tower-audit-existing-systems` — `5bfed702183e`
- `fix/waitlist-promotion-inapp-only` — `673900d17558`
- `fix/xp-balance-20261019` — `d45ea94c96e4`
- `fix-cron-discord-avatars-refresh` — `38f7e0b4f567`
- `fix-fadeinview-flash-then-hide` — `4533191bf338`
- `fix-multi-bugs-cron-oauth-gifs-pkce` — `7388bbb480bd`
- `fix-profil-blank-css-invisible` — `d27d00fb77bc`
- `fix-profil-client-nav-blank` — `439c9e15bb9f`
- `fix-profil-fadeinview-intersectionobserver` — `4596876844fd`
- `fix-reminders-discord-failure-timezone` — `fb70b69b2747`
- `fix-vote-inter-session` — `efa60119bf01`
- `fix-xp-atomicity` — `f7ee82dbd6ea`
- `force-relogin-discord` — `febfc3257e60`
- `integ/xp-vocal-20261022` — `1f38bd7128e6`
- `integ/xp-vocal-20261023` — `ea78a86e194f`
- `main` — `7f0dd053d3a9`
- `perf/calendrier-mobile` — `4081021df2b7`
- `perf/create-session-requetes` — `2597802d24da`
- `perf/diagnostic-cu-heures` — `ddc44cc53d6e`
- `perf/lectures-messages-v2` — `d3152c4eba6b`
- `perf/stabilisation-v2` — `53ed5a7fb8f3`
- `perf/steam-presence-ecritures` — `4fe5b620ef35`
- `polish-visuel-pra` — `3e292a2cc240`
- `polish-visuel-pra-fixes` — `98c64fbdd600`
- `preview-tower` — `ea1901595721`
- `reprise/crons-202` — `0d68a910a451`
- `restart-pr55` — `d36d03a8d7ef`
- `split-sessions-actions` — `38c69d43293b`
- `sprint4-pr-a` — `e1a5bb9d26dd`
- `sprint4-pr-b-stacked` — `de54c1dcd3c7`
- `sprint5-chat-wishlist` — `7cc84d66a97e`
- `sprint5-fix-season` — `3a40f586facb`
- `sprint5-fixes` — `9bb26259b522`
- `sprint5-tournois` — `a744dc1a593e`
- `test/audit-c-lot1` — `bab3733427bd`
- `test/audit-cdc-lot2` — `854ed9d112b5`
- `test/connexion-concurrente` — `eb4252f78670`
- `test/discord-jeux-gratuits-e2e` — `e656b88b3366`
- `test/discord-thread-cleanup-verif` — `4e3ba0569848`
- `test/env-example-coherence` — `3be535a6901f`
- `test/instant-sessions-e2e` — `725678dbb855`
- `test/lib-couverture-2` — `143ae63a617f`
- `test/lib-couverture-unitaire` — `998bc45c2ae7`
- `test/local-browser-recipe-readiness` — `e6710c5f9408`
- `test/readme-cron-routes` — `2cdadda0b4d3`
- `work/a1-migration-roles-20261023` — `6d14aba3dd38`
- `work/a2-repetition-restauration-20261023` — `1a68c78e22b1`
- `work/a3-worker-vocal-20261023` — `61ca4b3bb5ec`
- `work/a4-boutique-recette-20261023` — `3a901040c44d`
- `work/coord-tests-20261023` — `bf0ce1ca325b`
- `work/m-a-xp-livraison-20261023` — `6f59edf15564`
- `work/m-b-roles-barriere-20261023` — `f48ea92bec61`
- `work/m-c-worker-vocal-20261023` — `26788300394c`
- `work/m-d-discord-jeux-20261023` — `34e4b95b39f4`
- `work/m-f-push-calendrier-20261023` — `ce36ccfa103d`
- `work/m-g-exhaustivite-20261023` — `ecddc61c0461`
- `work/mission-complete-20261019` — `d029ea6a58f1`

</details>

## 8. Reste à faire, dans l’ordre

| Ordre | Action concrète | Qui | Risque | Accord requis |
|---|---|---|---|---|
| 1 | Examiner l’index Tower manquant ; reproduire la dérive sur base jetable, préparer une migration additive et tests si confirmé par le moteur Prisma | Codex ou Claude, un seul propriétaire | Modéré : DDL/performance | PR de correction distincte ; accord avant toute application Production |
| 2 | Réconcilier ROADMAP, reprise, commentaire CI et document de livraison avec main/les preuves actuelles | Codex ou Claude | Faible | PR documentaire distincte ; aucune fusion dans ce mandat |
| 3 | Préparer la configuration de chiffrement OAuth et des fonctions retenues : noms requis, procédure privée, gardes et recette sans secrets dans les rapports | Codex/Claude ; Maxime pour secrets et choix d’activation | Élevé si clé incorrecte/perdue | Autorisation séparée pour chaque modification Vercel ; rien à activer ici |
| 4 | Écrire un test d’intégration join→leave→rejeu RSVP instantané, puis corriger la déduplication ; examiner tournoi et concurrence | Codex ou Claude | Modéré | PR code ; pas d’accès Production requis pour développement local |
| 5 | Mesurer les crons synchrones sur fixtures chargées ; comparer au délai réel cron-job.org ; corriger uniquement les dépassements démontrés | Claude/Codex ; Maxime pour accès scheduler | Modéré | Lecture scheduler autorisée ; modification externe à approuver |
| 6 | Rafraîchir et faire revoir #325 face à main, sans intégrer silencieusement Tower ni anciennes migrations | Codex ou Claude, session coordonnée | Élevé | Mandat distinct pour toucher #325 ; interdit dans cet audit |
| 7 | Établir les six préconditions #325 : binding runtime→Neon, rôles distincts, barrière/drain des writers dont crons externes, sauvegarde fraîche restaurée en isolation, durée/impact du lot mesurés, migration explicite avant code | Maxime + opérateur Codex/Claude | Élevé | Fenêtre et opération exactes approuvées ; aucun accord déduit de la CI |
| 8 | Appliquer ensuite les six migrations et déployer #325 seulement si préconditions validées | Maxime + opérateur autorisé | Élevé | Accord maintenance explicite ; snapshot actuel seul insuffisant |
| 9 | Installer le worker vocal avec collecte OFF, vérifier hôte/supervision puis recette consentie | Maxime + opérateur | Élevé : données de présence | Installation, migration et activation = autorisations distinctes |
| 10 | Vérifier commandes enregistrées, droits bot, salons/rôles The Tower ; activer une fonction à la fois et recetter avec des membres consentants | Maxime ; Codex/Claude pour protocole/lecture | Élevé pour permissions et notifications | Accord spécifique avant enregistrement, message, permission ou flag |
| 11 | Compléter les exigences conservées : équipes selon profil ; arbitrer édition groupée, hors-ligne complet et autres extensions | Maxime pour périmètre ; Codex/Claude pour implémentation | Variable | Validation produit puis PR ; pas nouvelle fonctionnalité dans cet audit |
| 12 | Recette authentifiée finale : création→inscription→attente→désistement, tournoi/bracket, boutique/rangs, galerie, abonnements iCal, push sur appareils, rappels et échecs Discord | Maxime + opérateur | Modéré/élevé | Fixtures isolées d’abord ; notifications/écritures réelles explicitement autorisées |

## 9. Non vérifiable depuis cet environnement / contrôles arrêtés

- Valeurs des variables sensibles, clés valides, injection éventuelle hors variables projet, destination DATABASE_URL : non déchiffrées et non déduites.
- Commandes Discord enregistrées, rôles/overwrites effectifs, permissions du bot, état du tournoi Casino schedule : aucun connecteur Discord disponible.
- Paramétrage réel cron-job.org, writers hors dépôt, files et fonctions en vol : non inspectés.
- Windows de Maxime, journal C:\\Dev\\MEMOIRE_COMMUNE, dumps locaux, Ollama et Raspberry/SSH : non accessibles ici.
- Restauration du snapshot, effets historiques de remplissage de toutes les migrations, conformité intégrale defaults/FK/CHECK/types natifs : pas démontrés.
- L’arrêt demandé à l’écart d’index empêche de présenter ce document comme une validation exhaustive. Aucun refus d’accès n’a été contourné.
- « Aucune erreur runtime retournée » n’est ni un audit complet du trafic ni une preuve d’absence d’incident.
- Décisions vocales : les règles déjà approuvées ne sont pas redemandées ; ce sont les actions d’exploitation et les preuves de livraison qui restent.

**Conclusion opérationnelle :** socle déployé et testé ; projet non clos tant que les fonctions retenues ne sont pas configurées, les écarts traités et les recettes réelles démontrées. Aucun délai fiable n’est déduit du nombre de PR.
