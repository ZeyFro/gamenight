# Répétition complète XP + vocal : sauvegarde, migration, repli (local)

Preuve **locale uniquement** (Docker `127.0.0.1`, données synthétiques). Elle n'autorise aucune opération Production et ne prouve rien pour Production (voir « NON prouvé »).

## Commande

```bash
# 2 conteneurs jetables (A : répétition, B : cible de restauration), 127.0.0.1 seulement
docker run -d --name gn-a2-pg-20261023 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=gamenight_test -p 127.0.0.1:55472:5432 postgres:16-alpine -c fsync=off -c synchronous_commit=off
docker run -d --name gn-a2-restore-20261023 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=gamenight_test -p 127.0.0.1:55476:5432 postgres:16-alpine -c fsync=off -c synchronous_commit=off
git fetch origin main && npm ci
node scripts/rehearse-xp-full.mjs        # code 0 = toutes les étapes passent
```

Variables : `XP_FULL_CONTAINER_A/B`, `XP_FULL_PORT_A/B`. `XP_FULL_HOST` autre que `127.0.0.1` est refusé (code 2, avant tout appel Docker). Le script ne supprime jamais de conteneur ; il supprime ses bases, ses répertoires de travail et le dossier temporaire des sauvegardes (hors dépôt, `os.tmpdir()`, refusé s'il est dans le dépôt). Aucune donnée n'entre dans Git.

Fichiers : `scripts/rehearse-xp-full.mjs` (orchestrateur), `scripts/xp-backup-restore.mjs` (garde-fous, empreinte, ordonnancement, `pg_dump`/`pg_restore` via `docker exec`), tests purs `src/lib/xp-rehearsal.test.ts`. Réutilisés sans modification : `scripts/db-migrate.mjs` (boîte noire), `scripts/xp-balance-bascule.mjs`, `scripts/xp-rollout-migration-gate.mjs`.

## Étapes (ordre contrôlé par `assertStepOrder`)

| # | Étape | Ce qui est fait et vérifié |
|---|---|---|
| 1 | `preflight` | cibles 127.0.0.1, aucun nom/variable Neon, liaison des deux conteneurs, ref `origin/main`, rôles distincts `gn_migrator` / `gn_runtime` |
| 2 | `baseline-main` | `git archive origin/main` (schéma + 111 migrations) appliqué par `prisma migrate deploy` : historique = exactement main, pas de `xpBalance` ; 6 migrations absentes de main (XP : `20261019190000_separate_xp_balance`, `20261022142500_shop_balance_purchase_reason` ; vocal : 4) |
| 3 | `seed` | 300 utilisateurs, 3 communautés, 550 membres, 261 objets achetés, 725 événements XP (dont débits `SHOP_PURCHASE`), 120 paris ; bornes de niveaux/grades et `2147483647` ; aucun aléa, empreinte stable à la relecture et d'un run à l'autre |
| 4 | `backup` | `pg_dump -Fc` hors dépôt + sha256 ; empreinte = comptages par table + condensats md5 ordonnés + somme (BigInt) et condensat des soldes `xpTotal` ; inchangée par la sauvegarde |
| 5 | `barrier-close` | écrivain `gn_runtime` actif visible, `ALTER ROLE gn_runtime NOLOGIN` + `pg_terminate_backend` (mécanisme « b » de `rehearse-xp-role-barrier.mjs`, non importé : ce script est un orchestrateur sans export réutilisable) ; session terminée, reconnexion refusée (`not permitted to log in`), empreinte inchangée |
| 6 | `migrate` | `db-migrate.mjs` : dry-run (code 0, 6 migrations à appliquer, aucune écriture) puis `--execute --confirm-database` avec `MIGRATION_DATABASE_URL` (gn_migrator) et `DATABASE_URL` (gn_runtime) : « OK : 6 migration(s) appliquée(s) » |
| 7 | `verify` | historique complet et terminé, colonne + contrainte `xpBalance >= 0`, valeur d'enum `SHOP_BALANCE_PURCHASE`, 4 tables vocales ; données préservées (empreinte identique) ; `xpBalance = xpTotal` partout (règle : solde initial = progression), aucun négatif, somme égale |
| 8 | `bascule` | `xp-balance-bascule.mjs` sur la base migrée : `DÉJÀ BASCULÉ (aucune écriture)`, aussi avec `--execute --confirm` ; état (empreinte, soldes, historique) identique |
| 9 | `idempotence` | `db-migrate` relancé : refus propre code 2 (rien en attente) ; `prisma migrate deploy` : « No pending migrations » ; état identique |
| 10 | `barrier-open` | `ALTER ROLE gn_runtime LOGIN` : le runtime se reconnecte et lit `xpBalance` (privilèges par défaut hérités) |
| 11 | `fail-migration` | (a) clone restauré depuis la sauvegarde, migration `20261022130000_…` sabotée dans une copie : mauvais `--confirm-database` refusé (code 2), puis `db-migrate` code 3 ; 3 migrations du lot appliquées, 1 inachevée ; données de base inchangées ; relance refusée (code 2, « inachevée ») |
| 12 | `fail-wrong-target` | (b) code 2 sans connexion : hôte distant sans cible attendue, hôte ≠ attendu, hôte poolé, local sans `--allow-local`, base locale hors `gamenight_*`, rôle migration = runtime ; `rehearse-xp-full` refuse un hôte non local ; `xp-balance-bascule` refuse `neondb` |
| 13 | `fail-bascule-resume` | (c) bascule sur une copie restaurée dans B, 2e migration XP sabotée : REFUSÉ (« migrate deploy a échoué »), sauvegarde interne restaurée identique, état 1re migration terminée / 2e inachevée ; relance refusée (« inachevée ») ; **reprise** : nouvelle copie restaurée, migration saine : `BASCULE OK`, empreintes avant/restauré/après identiques, relance = `DÉJÀ BASCULÉ` |
| 14 | `fallback-restore` | (d) restauration du dump sur le conteneur B : empreinte identique à celle d'avant migration (`f93861fd…`), historique = main seul, pas de `xpBalance` ; contre-épreuve : un solde modifié change l'empreinte |

## Sortie réelle (deux runs consécutifs, code 0 ; extrait du dernier)

```
=== seed
  comptages : {"Community":3,"CommunityMemberCosmetic":261,"CommunityMemberStats":550,"Membership":550,"User":300,"XpBet":120,"XpEvent":725}
  soldes : 550 lignes, somme 2159230021, empreinte f93861fd55d789be…
=== backup
  sha256 du dump : 71d796bbed5a30476755d325bad6399556ca7237cdbadd895a22ed0596ef46f2
=== migrate
  | OK : 6 migration(s) appliquée(s) et terminée(s), aucune en attente.
=== bascule
  {"mode":"dry-run","state":"MIGRATED","divergentBalances":0,"negativeBalances":0,"result":"DÉJÀ BASCULÉ (aucune écriture)"}
=== idempotence
  | REFUSÉ : Migrations en attente différentes de --expect. Manquantes : [20261019190000_separate_xp_balance, … 20261022142500_shop_balance_purchase_reason]. Inattendues : []
=== fail-migration
  | ERROR: relation "TableInexistanteRepetition" does not exist
  | ÉCHEC de prisma migrate deploy (statut 1, signal aucun) : ne pas relancer ni utiliser `migrate resolve` sans revue de l'état exact.
=== fail-bascule-resume
  bascule interrompue : REFUSÉ — prisma migrate deploy a échoué : garder la maintenance, restaurer le dump dans une autre cible
  reprise : BASCULE OK
=== fallback-restore
  ok  repli : base restaurée sur B, empreinte identique à celle d'avant (f93861fd55d789be…)
RÉPÉTITION COMPLÈTE : OK (14 étapes)
originMain c12728b172727353bf9b43057bdb594841383d61
fingerprintBefore = fingerprintAfter = restoreDigest = f93861fd55d789be32adba1dbc4de40aa7dddbcfd0f5f9843c3b65b4d9329142
```

Aucune URL ni mot de passe n'est imprimé (mots de passe jetables de répétition remplacés par `***`).

## Prouvé en local

- Le lot exact `origin/main` → ce checkout (6 migrations) s'applique via `db-migrate.mjs` avec rôle de migration distinct, cible vérifiée, dry-run puis exécution confirmée, sur une base au schéma `main` portant des données réalistes.
- Aucune donnée existante n'est modifiée (empreinte identique) ; `xpBalance` = `xpTotal` ; les relances n'ont aucun effet.
- Une migration qui échoue au milieu du lot laisse un état détectable (migration inachevée) que `db-migrate` et la bascule refusent de relancer.
- Une sauvegarde `pg_dump -Fc` restaurée sur un autre cluster redonne une empreinte identique ; l'empreinte détecte une altération d'un solde.
- La barrière « rôle runtime `NOLOGIN` + terminate » draine une session active et empêche la reconnexion.

## NON prouvé

- Production : binding Vercel → Neon, sauvegarde Production fraîche et restaurable, drainage réel des writers (pooler, crons externes, tâches `after()` en vol, worker vocal), durée réelle de verrou/migration, rôles Neon (aujourd'hui un seul rôle propriétaire : la séparation migrateur/runtime n'y existe pas).
- La barrière locale utilise des rôles créés pour la répétition ; elle ne dit rien de Neon (pgbouncer, `BYPASSRLS`, rôles de plateforme).
- « Bascule interrompue » : l'interruption est **injectée** (migration sabotée dans une copie), pas un arrêt brutal du processus ; la reprise est la procédure documentée (restaurer dans une autre cible), pas une reprise « en place ».
- `xp-balance-bascule.mjs` n'accepte en attente que les deux migrations XP : sur ce checkout (4 migrations vocales en plus) il ne peut pas faire PRE → MIGRATED lui-même. La répétition l'exécute donc sur la base complète après `db-migrate` (étape 8, contrôle seul) et, pour le chemin PRE → MIGRATED, sur une copie du checkout sans les migrations vocales (étape 13).
- Tests d'intégration applicatifs (`test:postgres`) et suite complète : non lancés ici.

## Constats

- `xp-rollout-migration-gate.mjs` : le garde échoue dès qu'une migration autre que les deux migrations XP est en attente (cas de ce lot, vocal inclus). Pour un déploiement combiné, appliquer le lot par `db-migrate.mjs` ; le script de bascule ne sert alors que de contrôle.
- `db-migrate.mjs`, relancé sans rien en attente : code 2 avec « Manquantes : […] » ; cohérent mais peu lisible comme « rien à faire » (non modifié).
- `npx tsc --noEmit` signale 14 erreurs de typage dans `src/lib/db-migrate-lib.test.ts` (arguments optionnels de `assertTarget`), antérieures à ce travail.
