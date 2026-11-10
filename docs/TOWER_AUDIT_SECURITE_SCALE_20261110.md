# Revue ciblée de sécurité et de montée en charge — 10 novembre 2026

> Référence exacte : `main` SHA `6d6e30e76f4f96acb25c37fa6f97f08f42dca6c7`. Lecture des fichiers cités via GitHub, **sans exécution ni action Discord/Production**. Les constats doivent être repris dans l'ordre de coordination #400 ; pas de correctif direct sur les branches réservées ni de nouvelle PR avant libération d'une place. Aucun de ces points n'est présenté comme exploitation confirmée.

## A. P1 — Limiteur d'appels des server actions limité à une instance

**Preuve :** [src/lib/rate-limit.ts](../src/lib/rate-limit.ts) lignes 1–18 et 26, 46–69.

- `const buckets = new Map<string, RateLimitBucket>()` : limiteur de requêtes conservé seulement en mémoire de processus.
- Les commentaires confirment qu'il a été conçu pour environ 6 utilisateurs et que les compteurs se réinitialisent au redémarrage à froid et sont isolés entre les instances Vercel.
- À **500 ou 10 000 membres**, des appels répartis sur plusieurs fonctions n'ont **pas de plafond partagé garanti**. Ce n'est pas, à lui seul, une preuve de faille exploitable, car certaines opérations ont des protections de base transactionnelles et d'unicité distinctes.
- Les clés de `buckets` ne sont pas supprimées globalement après expiration : chaque ancien bucket n'est nettoyé que si la même clé est réutilisée. Risque de croissance mémoire par nombre de comptes/actions dans une instance chaude.

**Action :** mesurer les points d'entrée qui utilisent `checkRateLimit`, distinguer protection UX et protection d'intégrité ; définir des quotas partagés Postgres ou autre solution gratuite adaptée pour les mutations sensibles (création de groupes/vocaux, votes, preuves, invitations) ; bornes, TTL et repli sûr. Tester 2+ processus concurrents et charge sans service Redis payant par défaut.

**Critère :** le même utilisateur ne peut dépasser un quota global en répartissant les appels sur deux instances ; expiration des anciens compteurs ; aucune régression de quota transactionnel.

## B. P1 — Webhook APPLICATION_AUTHORIZED : fraîcheur de signature non contrôlée

**Preuve :** [src/lib/discord-webhook-events.ts](../src/lib/discord-webhook-events.ts) lignes 39–90, [src/lib/discord-signature.ts](../src/lib/discord-signature.ts) ligne 37, [src/lib/discord-interactions.ts](../src/lib/discord-interactions.ts) lignes 119, 142 et 165.

- Le webhook vérifie correctement la **signature cryptographique** du corps brut et de l'en-tête timestamp, puis parse l'événement. Mais **aucune limite d'âge du timestamp** n'est vérifiée dans `handleDiscordWebhookEvent`.
- À l'inverse, plusieurs chemins d'interactions Discord limitent déjà l'âge du timestamp à **300 secondes**.
- Quand `COMMUNITY_AUTO_CREATE_ENABLED=true`, la répétition d'un événement valide ancien pourrait provoquer une nouvelle réconciliation. [community-provisioning.ts](../src/lib/community-provisioning.ts) est idempotent pour la création et protège SUSPENDED/ARCHIVED, ce qui réduit le risque. Il peut toutefois réécrire les anciens nom/icône ou ramener une communauté `LEFT` à `PENDING` selon son état. **Un acteur devrait disposer d'un vrai couple payload+signature Discord ancien** ; ce n'est pas une falsification de signature ni une escalade admin démontrée.
- Le test `src/lib/discord-webhook-events.test.ts` injecte volontairement le timestamp fictif `123` avec signature simulée valide et attend une création. Il n'évalue pas la fraîcheur ni le replay.

**Action :** ajouter un garde d'horodatage anti-replay borné (sans changer le protocole attendu par Discord), rejeter les anciens événements **avant effet**, puis tests : horodatage ancien/futur, en-têtes manquants, signé mais rejoué, événement valide récent, désactivation et idempotence des réessais permis. Revalider la durée recommandée sur la documentation Discord et ne pas pénaliser les réessais légitimes.

**Critère :** aucune mutation de provisionnement à partir d'un événement signé au-delà de la fenêtre admise.

## C. P2 — Listing des équipes susceptible de devenir coûteux

**Preuve :** [src/lib/community-teams.ts](../src/lib/community-teams.ts) lignes 37–58 : `listCommunityTeams` charge tous les membres actifs avec leur score XP, toutes les séances admissibles par équipe et mappe le tout en mémoire ; pas de pagination/limite visible dans cette fonction.

**Action :** instrumentation et tests à 100/500/1 000 équipes fictives sur PostgreSQL jetable ; séparer vue liste paginée (nom, jeu, membres, recrutement) et détail d'une équipe (membres/séances). Conserver l'isolation communautaire et les règles de recrutement. Ne pas lancer de génération de charge sur Neon Production.

**Critère :** temps de réponse et taille payload bornés ; pagination stable et résultats identiques à données égales.

## D. Contrôles positifs et limites

| Contrôle | Preuve | Conclusion |
|---|---|---|
| Cron | [src/lib/cron-auth.ts](../src/lib/cron-auth.ts) : secret obligatoire, comparaison hash en temps constant, Preview bloquée | Barrière présente |
| Interaction Discord | Ed25519 corps brut et clé publique, refus 401/503 si absence/erreur | Barrière présente |
| Isolation Preview | [src/lib/discord-rest.ts](../src/lib/discord-rest.ts) ligne 303 interdit écritures REST Discord lorsque `VERCEL_ENV=preview` | Barrière présente pour ce client ; vérifier autres appels `fetch` directs |
| Création communauté | [src/lib/community-provisioning.ts](../src/lib/community-provisioning.ts) : `PENDING`, contrôle de concurrence `P2002` | Bon garde, sous réserve replay et recette |
| Administration Tower | Route `/api/admin/tower-layout` refus d'écriture (`POST` 423) ; contrôle owner sur `GET` | Lecture seule conservée |
| Suppression de fils | `discord-thread-cleanup` et `retention-cleanup` avec flags / mode dry-run | Contrôles présents, ne concernent pas les futurs vocaux privés |
| Vote et récompenses | `tower-challenge-voting.ts`, `tower-challenge-rules.ts` | Logique 24h/quorum/2 récompenses codée ; test entier Production non réalisé |

## E. Chantiers dépendants / séquencement

1. **Immédiatement** : consigner cette revue dans #432 et #400, sans toucher à #325/#370/#406.
2. **Avant ouverture à 500 membres** : traiter au moins les tests du limiteur distribué et le webhook anti-replay ; mesurer la liste d'équipes.
3. **Avant 10 000 membres** : tests de charge sur ressources isolées, quotas vocaux à la demande, file Discord respectant rate limits, métriques d'abus et supervision.
4. **Pour toute correction** : ajouter test de non-régression, revue TypeScript/ESLint/Prisma, CI sur SHA exact, jamais activer/merger sans approbation.

## F. Bloqueurs non résolus par cette lecture

Les connecteurs GitHub permettent de lire du code mais pas une exécution locale indépendante (le conteneur n'arrive pas à résoudre `github.com`). Aucun connecteur d'administration Discord direct n'est actuellement disponible ; les permissions, rôles et parcours actuels du serveur réel ne peuvent pas être certifiés. Ne pas signaler l'audit global comme « terminé » avant ces preuves.

**Aucune migration, permission, valeur de secret, variable Vercel, issue supplémentaire ou PR n'a été créée par cette revue.**

## G. Précision après consultation des sources Discord (10/11)

La [documentation officielle des Webhook Events Discord](https://github.com/discord/discord-api-docs/blob/main/developers/events/webhook-events.mdx) indique explicitement des **retries pendant jusqu'à 10 minutes** en cas d'échec. Le durcissement anti-replay ne doit donc **pas copier sans réflexion la fenêtre 300 secondes des interactions** : choisir et tester une fenêtre couvrant les retries légitimes, ou combiner déduplication durable par identifiant d'événement et fraîcheur raisonnable. La documentation officielle exige la signature Ed25519, mais n'impose pas ici de fenêtre anti-replay précise. Conserver l'événement initial valide malgré les retries ; rejeter la répétition après traitement avec un mécanisme idempotent.

## H. P2 — Dépendances : aucune attestation de vulnérabilités

`package.json` référence notamment Next.js `16.4.5`, React `19.2.8`, Prisma `^6.19.3`, `next-auth` `^5.0.0-beta.32`, `@vercel/blob`, `web-push`. La CI inspectée lance installation, tests, typage, ESLint et build, mais ne comporte **pas de contrôle explicite des avis de sécurité des dépendances** (`npm audit --audit-level=high` ou outil équivalent dans le workflow). Cela **ne prouve aucune CVE réelle** ; un examen de `package-lock.json` exact et des alertes GitHub Dependabot est nécessaire, sur les versions résolues et non les plages de `package.json`.

**Action :** lancer audit de dépendances en lecture seule sur un clone approuvé, classer vulnérabilités de production distinctement des dépendances de développement, préparer corrections par PR et CI complète. Ne pas mettre à jour aveuglément Next/Prisma/Auth à une nouvelle majeure ; aucune mise à jour automatique de packages n'a été faite ici.

## I. P1 — Recherche IGDB : quota et cache applicatif absents du chemin API

**Preuves :** `src/app/api/igdb/search/route.ts`, `src/lib/igdb.ts`, `src/app/api/igdb/search/route.test.ts`, lus sur `main` `6d6e30e`.

- La route `GET /api/igdb/search` exige une session valide et borne la longueur de la recherche à 100 caractères. **Points positifs confirmés** : 401 si non connecté, requêtes de moins de deux caractères sans appel IGDB et retour 502 sur échec.
- Pour chaque recherche admissible (deux caractères ou plus), le handler appelle directement `searchIgdbGames(query)`. **Aucun plafond de fréquence, cache de résultats ni déduplication concurrente n'apparaît dans ce chemin**. Le commentaire précise que la route est appelée à chaque frappe ; les tests contrôlent l'authentification et la troncature mais pas les appels successifs, la saturation ni les erreurs 429 d'IGDB.
- `src/lib/igdb.ts` conserve uniquement le **jeton d'accès Twitch** en mémoire ; ce cache n'évite pas les requêtes de recherche IGDB répétées.
- Risque **préventif** : dépenses de quotas ou ralentissements en cas de recherche concurrente, surtout à 500–10 000 membres. Ce n'est pas une preuve de panne actuelle.

**Correctif à concevoir :** débounce côté interface (amélioration UX seulement), garde d'appels mutualisé entre instances pour le serveur, cache de résultats avec durée d'expiration, limitation des recherches identiques simultanées, gestion des réponses IGDB 429 avec backoff borné. Prévoir un refus propre sans déclencher d'appels externes et ne pas polluer le cache d'une communauté par des données privées.

**Tests exigés :** appels rapprochés d'un seul utilisateur, plusieurs utilisateurs/instances, recherches identiques, expiration, échecs/429, indisponibilité Twitch/IGDB et conservation du filtre d'authentification.

## J. P2 — Point d'entrée public CSP, protection locale uniquement

**Preuves :** `src/app/api/csp-report/route.ts` et `src/app/api/csp-report/route.test.ts`.

La route CSP publique est désactivée par défaut et borne le corps à 16 Ko ; elle assainit les URI et écrit seulement un résumé dans les journaux. **C'est positif**. Quand activée, son unique limitation est `checkRateLimit("global","csp-report", `60/minute`)`, qui dépend de la `Map` par instance (cf. constat A) ; 60/min n'est **pas une borne globale entre instances**. Les tests mockent le limiteur et ne démontrent pas un blocage inter-instance.

**Action :** traiter avec la correction du limiteur distribué et vérifier la résistance du pipeline de logs à un trafic anonyme important, sans demander d'accès au serveur Discord ni rendre l'endpoint public par défaut.

## K. Revue supplémentaire de 13 routes API — observations de sécurité (pas un scan complet)

Sur le même SHA, lecture des routes backfill, calendrier, CSP, health, IGDB, push, média et Steam :
- Les **quatre routes backfill** consultées appellent `verifyCronRequest` ; `/api/health` également : protection cron et Preview héritée.
- `/api/calendrier/export` exige un utilisateur ; `/api/calendrier/feed/[token]` utilise un jeton opaque. Dans `calendar-feed.ts`, le jeton est généré aléatoirement (32 octets), stocké sous SHA-256, et la lecture revérifie communauté ACTIVE et membre ACTIVE avant de retourner les séances accessibles. **Barrières présentes**.
- `/api/push/subscription` exige une session valide et évite qu'un endpoint push existant soit rattaché à un autre utilisateur ; la limite de cinq endpoints est contrôlée avant création, avec gestion de conflit unique (P2002). **Barrières présentes** ; stress de création concurrente à vérifier sur Postgres.
- `/api/steam/callback` vérifie l'état du cookie, supprime le cookie d'état et valide la réponse OpenID auprès de Steam ; **protection contre la liaison CSRF présente**.
- `/api/igdb/search` : authentification présente, **garde de consommation d'API manquant dans le chemin**, détaillé au point I.

Les routes non relues ne sont pas réputées sûres par omission. Aucun test d'intrusion ni audit des dépendances n'a été exécuté dans cette session.

## L. Couverture des 11 routes cron — contrôle du point d'entrée

La totalité des **11 fichiers** `src/app/api/cron/**/route.ts` a été lue sur le SHA `6d6e30e` : `close-sessions`, `community-guild-sync`, `discord-thread-cleanup`, `free-game-discord`, `monthly-tasks`, `notification-executor`, `refresh-discord-profiles`, `reminders`, `retention-cleanup`, `steam-library-full-sync`, `steam-library-sync`.

**Résultat 11/11 :** chaque route appelle `verifyCronRequest(request)` et refuse les requêtes dont `auth.ok` est faux. Cette fonction, définie dans `src/lib/cron-auth.ts`, refuse les requêtes Preview, l'absence de `CRON_SECRET` et les credentials invalides. **Il n'y a pas de cron dépourvu de cette barrière d'entrée dans ces onze fichiers.**

Pour les actions les plus sensibles, les flags supplémentaires restent nécessaires : `retention-cleanup` exige `RETENTION_CLEANUP_ENABLED=true` et `RETENTION_CLEANUP_MODE=execute` pour la purge ; `discord-thread-cleanup` exige `DISCORD_THREAD_CLEANUP_ENABLED=true` et `DISCORD_THREAD_CLEANUP_MODE=execute`. Leurs modes dry-run par défaut sont documentés dans le code.

**Limites :** contrôle des *points d'entrée* seulement ; il ne démontre ni la correction de chaque tâche, ni le paramétrage réel d'un ordonnanceur externe, ni la sécurité de chaque requête SQL ou de la rétention, ni la bonne configuration du secret dans chaque environnement. Aucun cron n'a été déclenché.
