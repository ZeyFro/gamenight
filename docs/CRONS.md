# Routes cron et backfill

Toutes les routes de cette liste sont présentes dans le code. Les méthodes sont maintenues comme contrat par les tests de cohérence associés à ce document.

La route manuelle `/api/admin/force-relogin` n'est PAS une tâche planifiée : elle exige un secret dédié, `FORCE_RELOGIN_SECRET` (jamais `CRON_SECRET`, 503 sans lui). Les routes `/api/cron/*` et `/api/backfill/*` exigent `CRON_SECRET` et répondent 503 lorsque ce secret n’est pas configuré. Envoyer l’en-tête `Authorization: Bearer <CRON_SECRET>`. Les interrupteurs fonctionnels des jobs restent indépendants de cette authentification.

Le dépôt ne définit aucun déclencheur cron dans vercel.json. Le défi d’équipe Tower est préparé dans le workflow GitHub Actions `.github/workflows/tower-team-daily.yml` de #396; le schedule n’est pris en compte qu’après fusion dans la branche par défaut. Les autres tâches sont configurées par l’opérateur selon leur procédure propre; leur état réel n’est pas vérifiable depuis le code seul. Ne déduire aucun horaire des anciens comptes rendus.

## Routes cron et backfill

| Route | Méthodes | Rôle |
| --- | --- | --- |
| `/api/cron/tower-steam-autovalidate` | GET, POST | Validation automatique des défis Tower mesurables Steam (temps de jeu, succès) ; 202 + `after()` ; OFF si `TOWER_STEAM_AUTOVALIDATE_ENABLED` absent ; aucun déclencheur créé, cadence externe (10 min conseillées) |
| `/api/cron/tower-team-daily` | GET | Défi d'équipe quotidien ; workflow GitHub Actions #396, slots UTC 16:00/17:00 avec garde « heure de Paris ≥ 18 »; OFF si interrupteur absent; Preview bloquée |
| `/api/cron/close-sessions` | GET | Clôture des sessions échues |
| `/api/cron/community-guild-sync` | GET | Synchronisation de l’état des communautés Discord |
| `/api/cron/discord-thread-cleanup` | GET | Nettoyage des fils Discord |
| `/api/cron/free-game-discord` | GET | Préparation des annonces de jeux gratuits |
| `/api/cron/monthly-tasks` | GET | Tâches mensuelles ; **purge à 30 jours du journal d'erreurs serveur** (`ServerErrorLog`, lu sur `/admin/erreurs`) : ce cron quotidien tourne même interrupteurs éteints, il doit donc rester planifié 1 fois par jour |
| `/api/cron/notification-executor` | GET | Livraison de la file de notifications |
| `/api/cron/refresh-discord-profiles` | GET | Rafraîchissement des profils Discord |
| `/api/cron/reminders` | GET | Rappels de sessions |
| `/api/cron/retention-cleanup` | GET | Nettoyage de rétention |
| `/api/cron/steam-library-full-sync` | GET, POST | Synchronisation Steam complète |
| `/api/cron/steam-library-sync` | GET | Synchronisation Steam incrémentale |
| `/api/cron/booster-sync` | GET | Lecture REST de `premium_since` (soutiens Nitro) ; OFF si `DISCORD_BOOSTERS_ENABLED` absent ; aucun cron créé |
| `/api/cron/hosting-usage` | GET | Alerte avant saturation de l'hébergement gratuit (taille de la base ; 200 sous 70 %, 503 au-delà, le moniteur externe prévient par e-mail) ; OFF si `HOSTING_ALERT_ENABLED` absent ; lecture seule ; aucun cron créé |
| `/api/cron/team-captain-handover` | GET | Passation des capitaines d’équipe inactifs ; OFF et dry-run par défaut |
| `/api/cron/tournament-teams` | GET | Relance des confirmations de résultat (12 h) et lancement des tournois d’équipes à l’échéance d’inscription ; OFF sans `TOURNAMENT_TEAMS_ENABLED` ; 503 sans `CRON_SECRET` |
| `/api/cron/team-applications` | GET | Relance (48 h) et expiration (7 j) des candidatures d’équipe, retrait des accès Discord des membres non actifs ; OFF sans `TEAM_RECRUITERS_ENABLED` ; 503 sans `CRON_SECRET` |
| `/api/backfill/game-news` | POST | Backfill des nouvelles de jeux |
| `/api/backfill/igdb-coop` | GET, POST | Backfill des données coop IGDB |
| `/api/backfill/seed-reconcile` | GET, POST | Réconciliation des données seed |
| `/api/backfill/steam-store` | POST | Backfill des données Steam Store |

## Réponse 202 et `after()` (limite cron-job.org de 30 s)

cron-job.org coupe à 30 s. Les routes dont le travail peut les dépasser répondent `202` après l’authentification et les interrupteurs, puis travaillent dans `after()` (modèle : `steam-library-full-sync`). Le résultat est dans les logs Vercel (`début` / `fin`, erreurs en `logger.error` ; un `début` sans `fin` = coupure plateforme). Éteint, une route répond toujours `{enabled:false…}` en 200, de façon synchrone.

Converties en 202 :

| Route | Raison | `maxDuration` |
| --- | --- | --- |
| `/api/cron/notification-executor` | lot d’appels Discord, budget interne 50 s ; règle aussi la clôture des défis Tower quand `TOWER_CHALLENGES_ENABLED=true` (échéance de 15 s, lots de 25 tentatives, dans le même budget de 50 s) | 60 |
| `/api/cron/retention-cleanup` | purges et programmations, budget interne 45 s | 60 |
| `/api/cron/refresh-discord-profiles` | un appel HTTP Discord par compte, sans budget propre | 300 |
| `/api/cron/tower-steam-autovalidate` | au plus 25 lectures de l’API Steam par passage, budget interne 50 s ; une tentative n’est pas relue avant 10 minutes | 60 |

Aussi en 202 : `/api/cron/booster-sync` (un appel REST Discord par membre, lots de 100, budget 40 s, `maxDuration` 60).

Déjà en 202 : `steam-library-full-sync` et les backfills (`igdb-coop`, `seed-reconcile`, `steam-store`, `game-news`).

Laissées synchrones (travail court ou budget interne) :

| Route | Raison | `maxDuration` |
| --- | --- | --- |
| `community-guild-sync` | budget Discord de 20 s | défaut plateforme |
| `steam-library-sync` | budget de 25 s | 45 |
| `discord-thread-cleanup` | au plus 25 actions et budget de 45 s par passage (#355), uniquement des écritures en base (file) ; arrêt signalé par `truncated: true` | 60 |
| `free-game-discord` | uniquement des écritures en base (file) | 60 |
| `monthly-tasks` | no-op hors de la date d’échéance | défaut plateforme |
| `close-sessions` | requêtes et écritures en base, les annonces sont mises en file ; budget de 45 s (#354), arrêt signalé par `budgetExhausted: true` | 60 |
| `reminders` | idem, avec verrou ; à surveiller si le volume de sessions grossit | 60 |
| `team-captain-handover` | au plus 25 équipes préfiltrées ; dry-run sauf `TEAM_CAPTAIN_HANDOVER_MODE=execute` | 60 |
| `tournament-teams` | au plus 100 relances et 25 lancements par communauté et par passage ; le reste est repris au passage suivant | 60 |
| `team-applications` | au plus 100 candidatures et 50 retraits d’accès par communauté et par passage ; le reste est repris au passage suivant | 60 |

Un budget atteint n’est pas une erreur : le travail restant est repris au passage suivant (étapes idempotentes). Au-delà de 30 s, cron-job.org coupe la connexion mais la fonction continue jusqu’à son budget.

Les durées maximales éventuellement déclarées sont visibles dans chaque route source. Ce document ne fixe pas de fréquence ni ne prétend qu’un job externe est configuré.
