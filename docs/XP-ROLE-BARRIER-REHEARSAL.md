# Répétition locale : rôles distincts et barrière d'écriture (bascule `xpBalance`, #291)

Complète [XP-MAINTENANCE-PLAN.md](XP-MAINTENANCE-PLAN.md) et [XP-ROLLOUT-DECISION-20261019.md](XP-ROLLOUT-DECISION-20261019.md). Aucune opération Production : tout tourne dans Docker local (`node scripts/rehearse-xp-role-barrier.mjs`, conteneurs jetables `gamenight-xp-roles-*`, 127.0.0.1:55471, pgbouncer sur 55472, PostgreSQL 16.15, `fsync=off`). Aucun paquet npm ajouté : le script embarque un client PostgreSQL minimal (protocole simple, SCRAM) et se relance lui-même en « mode écrivain » pour jouer l'ancien runtime dans un processus séparé.

Reproduit : un seul rôle de connexion `neondb_owner` (propriétaire, non-superuser, `LOGIN CREATEDB CREATEROLE REPLICATION BYPASSRLS`), migrations de départ = checkout #291 sans les deux migrations XP, 2 000 utilisateurs synthétiques, ancien runtime = 5 connexions (2 occupées, 2 idle réutilisées à 0,7 s et 2 s, 1 qui se reconnecte toutes les 1,2 s) plus une transaction longue pilotée, une instance en direct et une via pgbouncer.

## Méthode retenue

**Rotation du mot de passe de `neondb_owner` puis `pg_terminate_backend` de ses sessions**, appliquée par le propriétaire lui-même.

```sql
ALTER ROLE neondb_owner PASSWORD '<nouveau>';          -- depuis une session neondb_owner conservée par l'opérateur
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE usename = 'neondb_owner' AND pid <> pg_backend_pid();
```

Pourquoi (mesuré, direct et pgbouncer) :

- Seule la rotation, `NOLOGIN` et `REVOKE CONNECT … FROM PUBLIC, neondb_owner` bloquent **toutes** les écritures après le terminate (0 écriture réussie, 46 à 47 refus sur 3 s) ; l'ancien runtime ne peut ni contourner ni annuler.
- Sans le terminate, aucune méthode ne coupe les connexions en vol ni les connexions idle réutilisées : ~89 écritures réussies pendant les 2 s qui suivent l'application, y compris une transaction longue qui commit.
- `NOLOGIN` n'est **pas applicable par neondb_owner à lui-même** (`42501`) : il faut un administrateur (console ou API plateforme). La rotation et le `REVOKE` le sont.
- `REVOKE CONNECT … FROM neondb_owner` seul n'a **aucun effet** (`PUBLIC` garde `CONNECT`) : le témoin `d0` continue d'écrire (131 OK / 0 refus).
- `default_transaction_read_only = on` n'est qu'un défaut de session : `BEGIN READ WRITE` écrit quand même ; en plus il n'a rien bloqué via pgbouncer (la session poolée voit `off`, cause non élucidée). À écarter.
- Le rôle `gn_migrator` (membre de `neondb_owner`, connexion et mot de passe propres) reste intact avec les quatre méthodes.
- Retour arrière : une instruction (4 ms), l'ancien writer reprend en 90 à 260 ms.

Réserve : la rotation sur Neon passe peut-être par la console/API et pourrait se propager aux variables Vercel de l'intégration. À reconfirmer. Les attributs de `neondb_owner` sur Neon (non-superuser, `CREATEROLE`, appartenance `neon_superuser` éventuelle) sont à reconfirmer, ils changent ce que `ALTER ROLE` accepte.

## Rôles (étape 1)

- `gn_runtime` : `LOGIN`, `NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS`, `USAGE` sur `public`, `SELECT/INSERT/UPDATE/DELETE` sur les tables, `USAGE/SELECT` sur les séquences, rien sur `_prisma_migrations`, privilèges par défaut pour les futures tables. Vérifié refusé (`42501`) : `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, lecture de `_prisma_migrations`.
- `gn_migrator` : `LOGIN`, mêmes attributs, **membre de `neondb_owner`** (méthode A, minimale). Peut `ALTER` les tables du propriétaire, qui restent possédées par `neondb_owner` ; les tables qu'il crée lui appartiennent (d'où les `ALTER DEFAULT PRIVILEGES` vers `gn_runtime`).
- Piège PostgreSQL 16 : `neondb_owner` devient membre des rôles qu'il crée (`admin=true`), donc `GRANT neondb_owner TO gn_migrator` est refusé comme circulaire. Il faut d'abord `REVOKE gn_migrator FROM neondb_owner` (sans effet depuis le propriétaire, octroi fait par le superutilisateur) puis le `GRANT` (refusé `42501` au propriétaire). Ces deux étapes demandent donc un administrateur.
- Méthode B, `REASSIGN OWNED BY ancien TO gn_migrator` (testée sur un propriétaire de test, jamais `neondb_owner`) : l'ancien writer est coupé net (`42501`, 31 refus, 0 écriture), et la base et les tables changent de propriétaire. C'est une rupture irréversible sans retransfert, pas un simple ajout de rôle : rejetée.
- L'ancien writer continue sans aucune erreur pendant et après la création des rôles (108 écritures OK sur 2,5 s, 0 erreur, direct et pooler).

## Preuve de drainage (étape 3)

Un `pg_stat_activity` isolé est trompeur : sur 70 relevés pendant que l'ancien runtime écrivait (294 écritures), 27 ne montraient aucune requête active, la connexion idle réutilisée était toujours présente sans rien écrire, et la connexion qui revient n'était vue dans aucun relevé alors qu'elle a écrit 1,2 s plus tard.

Preuve retenue : barrière + terminate + 10 relevés sur 4,6 s (0 session partout) + delta `pg_stat_database` nul (`tup_inserted/updated/deleted` = 0, contre 7/279/0 sans barrière) + ancien runtime : 0 écriture réussie, ~117 refus (`28P01` en direct, `08P01` via pooler) + canari avec les anciens identifiants refusé (direct et pooler) et 0 ligne canari en base. Le canari réussit avant la barrière (témoin positif).

## Durées mesurées

**Local, données synthétiques, non transposables à Production.** Une exécution (`fsync=off`, 2 200 lignes de stats, ~6 000 lignes de ledger, dump 365 Ko). Les écarts d'une exécution à l'autre sont de l'ordre de 10 à 30 %.

| Phase | Étape | ms |
|---|---|---|
| 1 | CREATE ROLE gn_runtime / gn_migrator | 6 / 4 |
| 1 | GRANT CONNECT, GRANT DML + séquences | 1 / 4 |
| 1 | REVOKE appartenance circulaire, GRANT neondb_owner TO gn_migrator | 23 / 2 |
| 1 | `REASSIGN OWNED` (comparaison B, base de 300 utilisateurs) | 56 |
| 2 | application de la méthode retenue (rotation) / terminate / retour arrière | 4 / 4 / 4 |
| 2 | fenêtre de fuite sans terminate (dernière écriture réussie après l'application) | ~2 300 |
| 2 | reprise de l'ancien writer après retour arrière (rotation, direct / pooler) | ~100 / ~160 |
| 3 | `gn_runtime` NOLOGIN, barrière, terminate (total) | 1 + 4 + 4 (9) |
| 4 | empreinte source / `pg_dump -Fc` / `docker cp` / SHA-256 | 75 / 243 / 62 / 1 |
| 4 | `createdb` + `pg_restore` / empreinte restaurée | 720 / 55 |
| 5 | `prisma migrate deploy` par `gn_migrator` (2 migrations) | 980 |
| 5 | invariants SQL / empreinte après migration | 53 / 58 |
| 6 | réouverture (`gn_runtime LOGIN`) / 3 achats direct / 2 achats pooler | 1 / 11 / 13 |
| 6 | invariants après réouverture | 49 |
| build | `migrate deploy` : `gn_runtime` (échec) / `gn_migrator` (2 en attente) / `gn_migrator` no-op / `gn_runtime` tout appliqué (échec) | 981 / 1 721 / 985 / 968 |
| 7 (ii) | restauration du dump dans une autre base / empreinte | 650 / 55 |
| 7 (i) | rejeu barrière + terminate / retrait / reprise de l'ancien writer | 9 / 6 / 65 |

Invariants vérifiés (assertions du script) : `xpBalance = xpTotal` sur toutes les lignes, aucun négatif, les deux migrations XP terminées une seule fois, empreinte progression/équipements/objets/ledger identique avant et après, base restaurée identique à la source. Après réouverture : exactement les 5 soldes achetés divergent, somme `xpBalance` en baisse de 50, somme `xpTotal` inchangée, ledger +5, `gn_runtime` refusé en DDL, ancien propriétaire toujours refusé.

## Point de build

`scripts/build.mjs` de cette branche n'exécute plus `prisma migrate deploy` (commit `18c505c`) ; celui de `origin/main` l'exécute à chaque build hors Preview. Avec `DATABASE_URL` = `gn_runtime`, `migrate deploy` **échoue** même sans migration en attente (`permission denied for table _prisma_migrations`, aucune colonne créée) ; avec `gn_migrator` il applique les migrations, puis est un no-op (`No pending migrations to apply`, exit 0), y compris via pgbouncer. Conséquence : tant que `main` migre au build, la variable `DATABASE_URL` du build doit rester celle du migrateur ; il faudra des variables distinctes build / runtime (ou retirer la migration du build, comme sur cette branche). `scripts/build.mjs` n'est pas modifié.

## Limites, non simulé

- Le pooler est **pgbouncer 1.26 en mode transaction**, pas celui de Neon : l'authentification, le recyclage et les codes d'erreur (`08P01` ici) peuvent différer.
- Pas de Neon : plateforme, scale-to-zero, proxy d'authentification, `neon_superuser`, console/API pour la rotation, intégration Vercel, latence réseau (tout est en loopback, durées de l'ordre de la milliseconde).
- Le rôle « administrateur » (création de rôles, `NOLOGIN`, `REVOKE` d'appartenance) est le superutilisateur local, en remplacement de la console Neon.
- Pas de vrai runtime Next.js ni Vercel : l'ancien runtime est un écrivain Node de 5 connexions (UPDATE `xpTotal`, INSERT `XpEvent`), sans Prisma ; les anciens déploiements Vercel, crons externes et `after()` en cours ne sont pas rejoués.
- Volume : 2 200 lignes de stats et ~6 000 événements, très en dessous d'une charge réelle ; le dump et les verrous ne sont pas représentatifs.
- L'écrivain principal est suspendu pendant la matrice de l'étape 2 (les attributs de rôle sont globaux au cluster), puis relancé sur la même base.
- PostgreSQL 16.15 local ; la version Neon est à confirmer (les règles `CREATEROLE` / appartenance changent selon la version).

## Revérification de la barrière (A1, 2026-10-23)

Relecture du script : les trois points demandés sont couverts par des **assertions** (le script sort en erreur sinon), pas seulement par des mesures.

- (a) Nouvelle connexion de l'ancien writer bloquée : la connexion « qui revient » (worker 4, ouvre/écrit/ferme toutes les 1,2 s) et le canari avec les anciens identifiants (direct et pooler) sont refusés après la barrière (`28P01` direct, `08P01` pooler) ; 0 ligne canari en base (phase 3b).
- (b) Connexion **déjà ouverte** avant la barrière : les connexions occupées, la connexion idle réutilisée (0,7 s et 2 s) et la transaction longue sont ouvertes avant l'application ; après `pg_terminate_backend`, 0 session (10 relevés sur 4,6 s), delta `pg_stat_database` nul et 0 écriture réussie de l'ancien runtime (`ok: 0`). Témoin positif : sans le terminate (méthode `d0`/`a`), 123 écritures réussies sur ces mêmes connexions.
- (c) Levée de barrière : phase 7 (i), barrière puis terminate (0 écriture réussie, 34 refus `28P01`), retrait par le propriétaire en une instruction, l'ancien writer reprend 55 ms plus tard, état PRE intact (0 colonne `xpBalance`, 0 migration XP). Phase 7 (ii) : repli par restauration du dump, empreinte identique.

Exécution du 2026-10-23 (`XP_ROLES_PORT=55481 XP_ROLES_CONTAINER=gn-a1-roles-pg node scripts/rehearse-xp-role-barrier.mjs`, Docker 29.8.2, `edoburu/pgbouncer:latest` tiré pour l'occasion) : **code de sortie 0** au second essai. Le premier essai a échoué en phase 2 (`délai de connexion` à 4 s sur le pooler, machine chargée par un `next build` concurrent) : non reproduit, à relancer sur une machine au repos si cela arrive. Écritures de l'ancien runtime après barrière : direct 0 OK / 109 refus, pooler 0 OK / 108 refus.
