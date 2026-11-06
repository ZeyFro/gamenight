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

Fichiers : `scripts/rehearse-xp-full.mjs` (orchestrateur), `scripts/xp-backup-restore.mjs` (garde-fous, empreinte, ordonnancement, `pg_dump`/`pg_restore` via `docker exec`), tests purs `src/lib/xp-rehearsal.test.ts`. Garde du lot complet : `scripts/xp-rollout-migration-gate.mjs` (`EXPECTED_ROLLOUT_MIGRATIONS`, `assertRolloutMigrationsPending`), vérifié par `node scripts/check-xp-rollout-migration-gate.mjs` et `src/lib/xp-rollout-gate.test.ts`, utilisé par `scripts/xp-balance-bascule.mjs`. `scripts/db-migrate.mjs` reste une boîte noire (non modifié).

## Étapes (ordre contrôlé par `assertStepOrder`)

| # | Étape | Ce qui est fait et vérifié |
|---|---|---|
| 1 | `preflight` | cibles 127.0.0.1, aucun nom/variable Neon, liaison des deux conteneurs, ref `origin/main`, rôles distincts `gn_migrator` / `gn_runtime` |
| 2 | `baseline-main` | `git archive origin/main` (schéma + 111 migrations) appliqué par `prisma migrate deploy` : historique = exactement main, pas de `xpBalance` ; 6 migrations absentes de main (XP : `20261019190000_separate_xp_balance`, `20261022142500_shop_balance_purchase_reason` ; vocal : 4), et `EXPECTED_ROLLOUT_MIGRATIONS` du garde = exactement ce lot déduit, dans l'ordre (`assertExpectedMatchesDerived`) |
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
| 13 | `fail-bascule-resume` | (c) bascule sur une copie restaurée dans B, **avec le lot complet de 6 migrations** (vocal inclus, aucune copie amputée), dernière migration sabotée : REFUSÉ (« migrate deploy a échoué »), sauvegarde interne restaurée identique, 5 migrations terminées / la 6e inachevée ; relance refusée (« inachevée ») ; **reprise** : nouvelle copie restaurée, migrations saines, chemin PRE → MIGRATED : `BASCULE OK`, empreintes avant/restauré/après identiques, relance = `DÉJÀ BASCULÉ` |
| 14 | `fallback-restore` | (d) restauration du dump sur le conteneur B : empreinte identique à celle d'avant migration (`f93861fd…`), historique = main seul, pas de `xpBalance` ; contre-épreuve : un solde modifié change l'empreinte |

## Sortie réelle (2 runs consécutifs après la fusion de `integ/xp-vocal-20261023`, code 0 chacun)

```
run A : RÉPÉTITION COMPLÈTE : OK (14 étapes)  exit=0
run B : RÉPÉTITION COMPLÈTE : OK (14 étapes)  exit=0
originMain c12728b172727353bf9b43057bdb594841383d61
fingerprintBefore = fingerprintAfter = restoreDigest = f93861fd55d789be32adba1dbc4de40aa7dddbcfd0f5f9843c3b65b4d9329142   (identique aux deux runs)
comptages : {"Community":3,"CommunityMemberCosmetic":261,"CommunityMemberStats":550,"Membership":550,"User":300,"XpBet":120,"XpEvent":725}, somme des soldes 2159230021
migrate : OK : 6 migration(s) appliquée(s) et terminée(s), aucune en attente.
bascule : {"state":"MIGRATED","divergentBalances":0,"negativeBalances":0,"result":"DÉJÀ BASCULÉ (aucune écriture)"}
idempotence : REFUSÉ : Migrations en attente différentes de --expect. Manquantes : [20261019190000_separate_xp_balance, … 20261022142500_shop_balance_purchase_reason]. Inattendues : []
fail-migration : ERROR: relation "TableInexistanteRepetition" does not exist / ÉCHEC de prisma migrate deploy (statut 1, signal aucun) …
fail-bascule-resume : bascule (lot complet de 6) → REFUSÉ — prisma migrate deploy a échoué ; 5 migrations terminées, la 6e inachevée ; reprise sur copie restaurée : BASCULE OK
fallback-restore : repli : base restaurée sur B, empreinte identique à celle d'avant (f93861fd55d789be…)
```

Les sha256 des dumps changent d'un run à l'autre (en-têtes `pg_dump`) alors que l'empreinte des données est identique ; seule l'empreinte fait foi. Contrôles complémentaires exécutés : `node scripts/check-xp-rollout-migration-gate.mjs` (« lot complet de 6 migrations = checkout moins origin/main »), `npx vitest run src/lib/xp-rollout-gate.test.ts src/lib/xp-rehearsal.test.ts` (27 tests), `npx tsc --noEmit` (0 erreur), `scripts/rehearse-xp-balance-bascule.mjs` (dry-run, refus sans confirmation, bascule OK, relance idempotente, cas négatif et partiel refusés).

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
- La liste du garde est figée dans le code et ne se compare à `origin/main` qu'au moment du contrôle : elle est à rejouer (`check-xp-rollout-migration-gate.mjs`) sur le checkout final, et devient caduque une fois le lot fusionné dans `main`.
- Tests d'intégration applicatifs (`test:postgres`) et suite complète : non lancés ici.

## Constats

- Garde corrigé : `xp-balance-bascule.mjs` raisonne sur le lot complet de 6 migrations (XP + vocal) ; `PRE` = rien du lot, `MIGRATED` = les 6 terminées plus colonne, contrainte et enum. Un état « XP seul appliqué » est `PARTIAL` (refusé) : migrer seulement le XP puis déployer un code qui lit les tables vocales casserait ces pages. L'ancien garde à 2 migrations (`assertOnlyExpectedXpMigrationPending`, `EXPECTED_XP_MIGRATIONS`) est conservé tel quel car `scripts/rehearse-xp-role-barrier.mjs` (A1) l'importe ; à retirer quand ce script sera migré.
- `db-migrate.mjs`, relancé sans rien en attente : code 2 conservé, message désormais « Rien à faire : aucune migration en attente… » (voir [LIVRAISON-BARRIERE.md](LIVRAISON-BARRIERE.md)).
