# GameNight

GameNight aide un groupe privé à organiser ses soirées jeux : disponibilités, choix des jeux, sessions et coordination Discord. L’interface est en français et pensée pour mobile.

## Fonctions

Le code du dépôt comprend notamment :

- disponibilités récurrentes et exceptions, calendrier et propositions de soirées avec votes ;
- bibliothèque de jeux, fiches enrichies, liaison Steam et import de jeux possédés ;
- sessions instantanées, tournois, roulette et listes d’attente ;
- profils, chat, XP, badges, classements et préférences de jeux ;
- annonces, rappels et interactions Discord, selon la configuration activée.

La présence du code ne prouve pas que les intégrations ou les réglages sont actifs sur un déploiement. Les états de configuration distants ne sont pas publiés dans ce dépôt.

## Stack

- Node.js 22 pour la CI ; Next.js 16 App Router, React 19 et TypeScript ;
- Tailwind CSS 4, Auth.js v5 avec OAuth Discord ;
- Prisma 6 et PostgreSQL ; le client de déploiement utilise l’adaptateur Neon ;
- Vercel pour la plateforme visée ; Vitest et ESLint pour les contrôles du dépôt.

## Démarrage local

La procédure reproductible utilise un PostgreSQL 16 local, lié uniquement à 127.0.0.1. Elle n’utilise ni Neon ni une base partagée.

Voir [Développement local](docs/DEVELOPPEMENT_LOCAL.md) pour les prérequis, la configuration .env, les migrations locales et la base séparée pour les tests PostgreSQL.

Démarrage rapide après configuration :

    npm ci
    npx prisma migrate deploy
    npm run dev

npm run build applique aussi les migrations à DATABASE_URL hors Preview. En local, vérifie que cette URL vise bien ta base locale avant de l’utiliser.

## Intégrations et activation

Les fonctions suivantes ont du code livré ; leur utilisation demande les identifiants, permissions, migrations ou interrupteurs indiqués. Les valeurs réelles ne sont pas dans le dépôt.

| Domaine | Activation ou configuration nécessaire |
| --- | --- |
| Connexion Discord | Identifiants OAuth et URL de retour. Une Membership ACTIVE ou `ADMIN_DISCORD_IDS` autorise la connexion ; les données collectives restent réservées aux membres de la communauté concernée, même si l’isolation est désactivée. |
| Annonces et rappels Discord | Webhook ou bot, permissions et salons configurés ; CRON_SECRET, tâches externes et interrupteurs concernés pour les traitements planifiés. |
| Import et synchronisation Steam | Compte Steam lié ; STEAM_API_KEY et tâche externe pour les imports/synchronisations qui l’utilisent. |
| Recherche et enrichissement IGDB | IGDB_CLIENT_ID et IGDB_CLIENT_SECRET d’une application Twitch. |
| Traduction des descriptions | DEEPL_API_KEY, facultative ; sans elle, le texte source reste disponible. |
| Bannières et médias | BLOB_READ_WRITE_TOKEN pour les bannières ; le média privé a son propre token et ses interrupteurs. |
| Notifications navigateur | Clés VAPID et WEB_PUSH_ENABLED. |
| Calendrier iCal privé | CALENDAR_SUBSCRIPTIONS_ENABLED et sa migration. |

Les interrupteurs sont documentés dans [l’index des documents](docs/INDEX.md) et leurs détails dans les guides associés. Ils sont généralement désactivés par défaut ; leur présence dans .env.example ne signifie pas qu’ils sont activés sur Vercel.

## Commandes disponibles

Les scripts npm réellement définis dans package.json :

| Commande | Usage |
| --- | --- |
| npm run dev | Serveur de développement |
| npm run build | Migrations puis compilation, selon l’environnement |
| npm start | Serveur Next.js compilé |
| npm run lint | ESLint |
| npm test | Tests Vitest |
| npm run test:postgres | Tests d’intégration PostgreSQL ; voir le guide local |
| npm run backfill-coop | Backfill IGDB coop |
| npm run backfill-steam-coop | Backfill coop depuis Steam |

## Documentation

- [Index des documents](docs/INDEX.md) — guides actuels, opérations et archives.
- [Développement local](docs/DEVELOPPEMENT_LOCAL.md) — recette locale PostgreSQL.
- [Routes cron et backfill](docs/CRONS.md) — méthodes HTTP et protection ; les cadences sont gérées hors dépôt.
- [Sécurité : réconciliation du travail de Claude](docs/SECURITE_CLAUDE.md) — sources, constats, correctifs et validations.
- [Déploiement multi-communautés](docs/COMMUNITY_ROLLOUT.md) — ordre et limites opérationnelles.
- [Feuille de route](docs/ROADMAP.md) — suivi des lots.
- [Brief initial](SPEC-gamenight.md) — document d’origine, pas une spécification complète de l’état actuel.
- [Archives documentaires](docs/archive/README.md) — journaux et rapports historiques.
