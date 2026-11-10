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
