# Routes cron et backfill

Toutes les routes de cette liste sont présentes dans le code. Les méthodes sont maintenues comme contrat par les tests de cohérence associés à ce document.

Les routes `/api/cron/*` et `/api/backfill/*` exigent `CRON_SECRET` et répondent 503 lorsque ce secret n’est pas configuré. Envoyer l’en-tête `Authorization: Bearer <CRON_SECRET>`. Les interrupteurs fonctionnels des jobs restent indépendants de cette authentification.

Le dépôt ne définit aucun déclencheur cron dans vercel.json. Les tâches et leurs cadences sont configurées par l’opérateur dans un service externe ; leur état réel n’est pas vérifiable depuis le code seul. Ne déduire aucun horaire des anciens comptes rendus.

## Routes cron et backfill

| Route | Méthodes | Rôle |
| --- | --- | --- |
| `/api/cron/close-sessions` | GET | Clôture des sessions échues |
| `/api/cron/community-guild-sync` | GET | Synchronisation de l’état des communautés Discord |
| `/api/cron/discord-thread-cleanup` | GET | Nettoyage des fils Discord |
| `/api/cron/free-game-discord` | GET | Préparation des annonces de jeux gratuits |
| `/api/cron/monthly-tasks` | GET | Tâches mensuelles |
| `/api/cron/notification-executor` | GET | Livraison de la file de notifications |
| `/api/cron/refresh-discord-profiles` | GET | Rafraîchissement des profils Discord |
| `/api/cron/reminders` | GET | Rappels de sessions |
| `/api/cron/retention-cleanup` | GET | Nettoyage de rétention |
| `/api/cron/steam-library-full-sync` | GET, POST | Synchronisation Steam complète |
| `/api/cron/steam-library-sync` | GET | Synchronisation Steam incrémentale |
| `/api/backfill/game-news` | POST | Backfill des nouvelles de jeux |
| `/api/backfill/igdb-coop` | GET, POST | Backfill des données coop IGDB |
| `/api/backfill/seed-reconcile` | GET, POST | Réconciliation des données seed |
| `/api/backfill/steam-store` | POST | Backfill des données Steam Store |

Les durées maximales éventuellement déclarées sont visibles dans chaque route source. Ce document ne fixe pas de fréquence ni ne prétend qu’un job externe est configuré.
