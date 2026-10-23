# Livraison Discord et jeux gratuits : recensement, arrêt, recette

Établi depuis le code (grep `process.env.*`, appels REST de `src/lib/discord-rest.ts`, routes `src/app/api`). Aucune valeur de secret ici. Tout est éteint par défaut : seule la chaîne exacte `true` allume (`MODE=execute` pour les nettoyages), prouvé par `src/lib/discord-flags-default-off.test.ts`.

## 1. Variables par fonction

Communes : `DISCORD_BOT_TOKEN` (sans lui aucun appel Discord n'est tenté), `CRON_SECRET` (sans lui les routes cron répondent 503), `NOTIFICATION_EXECUTOR_ENABLED` (sans lui rien n'est réclamé ni envoyé), `DISCORD_BOT_GUILD_ID`.

| Fonction | Variables indispensables |
| --- | --- |
| Annonce de soirée, fil, RSVP, rappels, liste d'attente | `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`, `DISCORD_BOT_GUILD_ID`, `DISCORD_BOT_SESSION_CHANNEL_ID`, `NOTIFICATION_EXECUTOR_ENABLED`, `DISCORD_BOT_TOKEN`, `DISCORD_APP_PUBLIC_KEY` (boutons RSVP), `CRON_SECRET` (rappels : cron `reminders`) |
| MP de soirée | idem + `DISCORD_DM_SESSION_ENABLED` |
| Annonce de tournoi, résultats de match, RSVP tournoi | `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED`, `DISCORD_BOT_GUILD_ID`, `DISCORD_BOT_TOURNAMENT_CHANNEL_ID`, `NOTIFICATION_EXECUTOR_ENABLED`, `DISCORD_BOT_TOKEN`, `DISCORD_APP_PUBLIC_KEY` |
| MP de tournoi / roulette | `DISCORD_DM_TOURNAMENT_ENABLED` / `DISCORD_DM_ROULETTE_ENABLED` |
| « Jouer maintenant » (invitation MP, RSVP) | `DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED`, `DISCORD_BOT_TOKEN`, `NOTIFICATION_EXECUTOR_ENABLED`, `DISCORD_APP_PUBLIC_KEY` |
| Jeux gratuits | `FREE_GAME_FEED_ENABLED`, `COMMUNITY_CHANNELS_ENABLED`, `DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED`, `NOTIFICATION_EXECUTOR_ENABLED`, `DISCORD_BOT_TOKEN`, `CRON_SECRET` ; salon `FREE_GAMES` par communauté (`CommunityChannelConfig`) et `Community.freeGamesEnabled` ; pour `default` le serveur vient de `DISCORD_BOT_GUILD_ID` |
| Nettoyage / archivage des fils | `DISCORD_THREAD_CLEANUP_ENABLED`, `DISCORD_THREAD_CLEANUP_MODE` (`execute`, sinon dry-run), `DISCORD_THREAD_CLOSE_ON_END_ENABLED` (archive à la fin, exige le nettoyage en `execute`) |
| Commande `/gamenight setup`, webhook d'événements | `COMMUNITY_SETUP_COMMAND_ENABLED`, `COMMUNITY_AUTO_CREATE_ENABLED`, `DISCORD_APP_PUBLIC_KEY` |
| Repli webhook (sans bot) | `DISCORD_WEBHOOK_URL` (jamais utilisé si le chemin bot est actif pour la fonction) |
| Autres lues dans le périmètre | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` (OAuth, `discord-user-guilds`), `AUTH_URL` (liens dans les messages), `RETENTION_CLEANUP_ENABLED` / `RETENTION_CLEANUP_MODE` |

## 2. Permissions du bot

Déduites des appels REST réels (`discord-rest.ts`) et de `SETUP_PERMISSIONS` (`discord-setup-permissions.ts`, contrôlées par l'écran communautés) :

| Appel REST | Permission |
| --- | --- |
| `POST /channels/{id}/messages`, `PATCH .../messages/{id}`, `DELETE .../messages/{id}` | Voir les salons, Envoyer des messages, Voir l'historique des messages |
| Embeds et liens (jeux gratuits, annonces) | Intégrer des liens |
| `POST .../messages/{id}/threads`, `POST /channels/{id}/threads` | Créer des fils publics / privés |
| `PATCH /channels/{thread}` (archivage), `DELETE /channels/{thread}` | Gérer les fils |
| `PUT/DELETE /channels/{thread}/thread-members/{user}` | Gérer les fils, Envoyer des messages dans les fils |
| `POST /users/@me/channels` + message (MP) | Aucune permission serveur ; MP fermé = 403 code 50007 classé `dm_unavailable` |
| `GET /channels/{id}`, `GET /guilds/{id}`, `/guilds/{id}/members/{bot}`, `/guilds/{id}/channels` | Voir les salons (vérifications avant envoi, écran communautés) |
| `POST/PATCH /guilds/{id}/channels` | Gérer les salons (création de salons par l'écran communautés) |
| Réactions | Aucun appel de réaction dans le code : permission inutile (les RSVP sont des boutons) |

Mentions : `allowed_mentions` désactivées par défaut (jeux gratuits : `parse: []`).

## 3. Salons nécessaires

Soirées (`DISCORD_BOT_SESSION_CHANNEL_ID`), tournois (`DISCORD_BOT_TOURNAMENT_CHANNEL_ID`), jeux gratuits (catégorie `FREE_GAMES` de la communauté). Vocal exclu. Les fils sont créés sous l'annonce.

## 4. Endpoints et intents

- Aucun intent Gateway pour ces fonctions (REST uniquement ; le Gateway ne sert qu'au vocal, hors périmètre).
- `POST /api/discord/interactions` : URL d'endpoint d'interactions de l'application ; signature Ed25519 (`x-signature-ed25519`, `x-signature-timestamp`, clé `DISCORD_APP_PUBLIC_KEY`) ; PING acquitté même éteint ; boutons RSVP (type 3) et `/gamenight setup` ; `maxDuration` 120.
- `POST /api/discord/webhook-events` : webhook d'événements (« application autorisée »), même signature ; 503 sans clé, 401 si signature invalide ; sans effet hors `COMMUNITY_AUTO_CREATE_ENABLED`.

## 5. Tâches planifiées externes (cron-job.org)

En-tête : `Authorization` (valeur `Bearer` + `CRON_SECRET`). Sans secret : 503 ; mauvais : 401. Fréquences recommandées (le dépôt n'en fixe aucune, pas de cron dans `vercel.json`) :

| Chemin | Méthode | Fréquence recommandée | maxDuration | Remarque |
| --- | --- | --- | --- | --- |
| `/api/cron/notification-executor` | GET | 1 à 5 min | 60 s | filet : retries, éditions différées ; budget de lot 50 s |
| `/api/cron/reminders` | GET | 5 min | 60 s | rappels selon `reminderTimings` (24 h / 2 h / 1 h) |
| `/api/cron/free-game-discord` | GET | 1 h | 60 s | met en file, l'executor envoie |
| `/api/cron/discord-thread-cleanup` | GET | 1 jour | 60 s | dry-run sauf `MODE=execute` |
| `/api/cron/close-sessions` | GET | 15 min | défaut | clôture des soirées |
| `/api/cron/community-guild-sync` | GET | 1 jour | défaut | sans effet hors `COMMUNITY_AUTO_CREATE_ENABLED` |

Écarts constatés (à arbitrer, rien modifié) :

1. cron-job.org coupe à 30 s ; `notification-executor` (budget 50 s), `reminders`, `free-game-discord` et `discord-thread-cleanup` (60 s) répondent en synchrone, pas en 202 + `after()`. Seuls `steam-library-full-sync` et les backfills longs le font. Une coupure côté cron-job.org n'arrête pas forcément la fonction, mais le job apparaît en échec : tolérer le timeout ou passer ces routes en 202.
2. `README.md` ne contient plus de tableau des crons ni des variables : il renvoie à `docs/CRONS.md` (routes et méthodes conformes au code, mais ni fréquence ni durée). CLAUDE.md parle encore d'un « tableau README ».
3. `docs/CRONS.md` ne documente ni `maxDuration` ni le contrat 202.

## 6. Désactivation, comportement éteint, arrêt d'urgence

| Fonction | Interrupteur | Une fois éteint |
| --- | --- | --- |
| Tout envoi bot | `NOTIFICATION_EXECUTOR_ENABLED` | livraisons restent `PENDING` (0 tentative), rien d'envoyé, file conservée ; reprise intacte à la réactivation |
| Annonces soirées | `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED` | plus de nouvelle annonce ; aucun repli public ; livraison déjà en file traitée tant que l'executor est actif |
| Annonces tournois | `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED` | idem ; aucun résultat de match mis en file |
| MP soirée / tournoi / roulette | `DISCORD_DM_*_ENABLED` | plus de création de MP ; MP déjà en file traités |
| Jouer maintenant | `DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED` | plus d'invitation MP |
| Jeux gratuits | `DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED` (ou `FREE_GAME_FEED_ENABLED`, ou `Community.freeGamesEnabled`) | route cron `{enabled:false}`, rien en file ; livraison déjà en file : annulée par la garde d'expiration / de communauté |
| Fils | `DISCORD_THREAD_CLEANUP_ENABLED` / `MODE` autre que `execute` / `DISCORD_THREAD_CLOSE_ON_END_ENABLED` | rien lu ni écrit / dry-run / pas d'archivage à la fin |
| Interactions | `COMMUNITY_SETUP_COMMAND_ENABLED`, `COMMUNITY_AUTO_CREATE_ENABLED` | refus poli / sans effet |

Arrêt d'urgence, par ordre de rapidité :

1. Retirer `NOTIFICATION_EXECUTOR_ENABLED` (ou valeur autre que `true`) : plus aucun envoi, kick `after()` compris.
2. Mettre en pause les tâches cron-job.org.
3. Retirer `DISCORD_BOT_TOKEN` : aucun appel tenté.
4. En dernier recours, révoquer le jeton dans le portail développeur Discord.

Les livraisons restent en base ; une fois la cause corrigée, réactiver l'étape 1.

## 7. Recette réelle courte (opérateur, jamais lancée depuis un test)

Prérequis : serveur Discord de test dédié, salon `#test-gamenight` (bot avec les permissions du §2), compte de test lié, soirée de test à J+25 h, une seule communauté de test `ACTIVE`.

1. Définir les variables du §1 pour l'environnement de test uniquement (salon de test) ; `NOTIFICATION_EXECUTOR_ENABLED=true` en dernier.
2. Dans le portail, URL d'endpoint d'interactions = `/api/discord/interactions` : Discord doit la valider (PING).
3. Créer la soirée de test : une annonce dans le salon, fil créé, créateur non mentionné.
4. Cliquer « Je viens » avec le compte de test : confirmation privée, inscription visible sur le site. Recliquer : état inchangé, pas de doublon.
5. Cliquer « Je viens pas » : désistement ; avec capacité 1 et un second compte en attente, il est promu (notification dans l'application).
6. Appeler `GET /api/cron/reminders` (en-tête d'autorisation) vers 24 h, 2 h, 1 h avant : un message par palier ; rappeler : aucun second message.
7. Changer la date de la soirée : annonce éditée, rappels réarmés pour la nouvelle date.
8. Créer un tournoi de test et déclarer un vainqueur de match : un résultat dans le fil, sans ping ; rappeler l'executor : rien de plus.
9. Jeux gratuits : activer `FREE_GAME_FEED_ENABLED` et `DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED`, salon `FREE_GAMES` = salon de test ; `GET /api/cron/free-game-discord` puis l'executor : une annonce par offre, rien au second passage.
10. Vérifier qu'aucune livraison n'est `FAILED` ; sinon lire la classe d'erreur (permission, message supprimé).
11. Annuler : retirer `NOTIFICATION_EXECUTOR_ENABLED`, mettre les crons en pause, supprimer la soirée et le tournoi de test (fils supprimés à la main ou par le nettoyage en `execute`), retirer les variables de test.
12. Noter les écarts avant toute décision de production.

## 8. Preuves par test (nom du test)

Chemins sous `src/`. « I » = intégration Postgres avec Discord simulé (`fetch` mocké).

- Rappels : `lib/reminders.test.ts` (seuils, DST, « plusieurs dus d'un coup », création) ; `app/api/cron/reminders/route.integration.test.ts` (I) : « une nouvelle date réarme les seuils et crée une nouvelle livraison du même palier », « A → B → A permet un nouveau rappel sans réutiliser l'ancienne occurrence », « rejouer l'enqueue du même rappel ne crée ni 2e événement ni 2e livraison », « VOTING : « 1h avant » part à son heure… ».
- RSVP : `lib/discord-session-rsvp.test.ts` (« retry déjà traité : confirmation neutre »), `lib/discord-tournament-rsvp.test.ts`, `lib/discord-instant-session-rsvp.test.ts` (« keeps leave idempotent… »), `lib/discord-rsvp-interactions.test.ts` (signature, ACK, MP).
- Liste d'attente : `lib/session-seats.integration.test.ts` (I) : « désistement : promotion FIFO durable une seule fois… », « notifie la promotion dans l'application… », « une invitation révoquée ou un membre retiré est sauté… ».
- Résultats de match : `lib/tournament-announce.integration.test.ts` (I) : « résultat de match : enqueue dans le thread, par match, sans ping… », « répétition d'un declareWinner déjà tranché : … aucune notification en double », « tournoi sans annonce bot : aucun résultat Discord n'est mis en file ».
- Erreurs Discord : `lib/notification-executor.integration.test.ts` (I) : « rate limit (429) : nextAttemptAt respecte exactement le Retry-After », « échec permanent (403 générique) : FAILED terminal », « résultat réseau incertain… », « au-delà de MAX_DELIVERY_ATTEMPTS… FAILED terminal » (MAX = 8), « désactivée par défaut… ». Édition 404 : `lib/session-announce.integration.test.ts` « message d'annonce supprimé manuellement (404 sur l'EDIT) : FAILED terminal, observable, jamais republié ». MP fermé : `lib/discord-rest.test.ts` « 403 code 50007 en contexte DM → dm_unavailable ».
- Jeux gratuits : `lib/free-game-discord.integration.test.ts` (I) : « envoie une annonce sans mention, puis rien de plus à la relance… » (anti-doublon), « n'envoie rien si l'offre a expiré… » (expiration), « reporte sans envoyer si la source est indisponible… », « réessaie après une erreur Discord 500… », « permission refusée (403) : FAILED terminal observable… » (nouveau), « rate limit (429) : reprise différée… » (nouveau), « n'envoie rien si la communauté désactive les offres… ». `lib/gamerpower-free-games.test.ts` : curation (« ne publie que les jeux actifs qui redirigent vers Steam ou Epic »), « dédoublonne deux giveaways qui mènent au même produit… » (nouveau, avec correctif), relevés périmés, sources Steam et Epic indépendantes. `lib/free-game-offers.access.test.ts` : « garde le manuel prioritaire et retire les doublons du flux optionnel ».
- Éteint par défaut : `lib/discord-flags-default-off.test.ts` (nouveau), `lib/notification-executor-kick.test.ts`, `lib/free-game-discord.test.ts`.
