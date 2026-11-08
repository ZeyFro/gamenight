# Neon Test : garde d'URL du runner (`sslaccept=strict`) et table étrangère `playing_with_neon`

Complète #419 (`docs/operations/NEON_TEST_APPLY_REVIEW.md`). Aucune connexion à une base, aucune écriture, aucune activation : ce document et son correctif ne touchent ni Neon, ni le workflow d'application hors l'étape d'assemblage.

## 1. Correctif : `sslaccept=strict` dans le garde d'URL du runner

**Blocage (vérifié).** `scripts/neon-test/native-tls.mjs` transmet au préflight, au runner et à Prisma une même URL `sslmode=require&sslaccept=strict`. Le runner épinglé de #370 (`scripts/db-migrate-lib.mjs` @ `4a18b74`, identique à la tête `6cff66b`) n'admet que `sslmode`, `connect_timeout`, `connection_limit`, `pool_timeout`, `application_name`, `channel_binding` et refuse le reste : « Paramètre d'URL non autorisé : sslaccept ». Le préflight de #418 et `db-migrate.mjs` passent tous deux par ce garde.

**Correctif.** `scripts/neon-test/runner-ssl.mjs` corrige la COPIE assemblée du fichier (le runner de #370 n'est pas modifié) :

- vérifie l'empreinte SHA-256 du fichier épinglé (`b9728798…feea`) avant, et celle du résultat (`f0000ab8…82d2`) après ; toute autre source est refusée (`NEON_TEST_RUNNER_LIB_NOT_PINNED`) ;
- admet `sslaccept` **uniquement** sous la forme exacte `sslaccept=strict`, **une seule fois**, clé en minuscules ;
- refuse toujours : `accept_invalid_certs`, valeur vide ou d'une autre casse, `strict` suivi d'un espace, doublons, `SSLACCEPT`/`sslAccept`, et tous les paramètres de redirection (`host`, `schema`, `options`, `service`, `sslcert`, `sslidentity`…) ;
- le workflow l'exécute dans l'étape « Assemble », juste après la copie du runner.

**Contre-test sur l'assemblage réel** (`src/lib/neon-test-runner-ssl.test.ts`) : l'étape « Assemble » est extraite du YAML et exécutée telle quelle dans un espace temporaire contenant le runner épinglé (fixtures `scripts/neon-test/fixtures/runner-4a18b74/`, empreintes vérifiées). Le test vérifie (1) que le runner épinglé NON corrigé refuse l'URL du workflow (le blocage est reproduit), (2) que le runner assemblé l'accepte, (3) 14 variantes dangereuses ou ambiguës refusées, (4) que le CLI assemblé laisse passer `sslaccept=strict` (il refuse plus loin sur la cible attendue, avant toute connexion) et refuse `accept_invalid_certs` et le doublon, (5) qu'aucune migration #406 n'est assemblée.

Si #370 modifie un jour ce fichier, l'empreinte épinglée ne correspond plus et l'assemblage s'arrête : le workflow épingle déjà le commit `4a18b74`.

## 2. `playing_with_neon` : `validate` refuse-t-il Neon Test ?

**Oui, d'après le code et une reproduction locale.**

- `scripts/neon-test/state.mjs` (`readState`) calcule `schema = digest({columns, constraints, indexes, enums})` sur **toutes** les tables ordinaires du schéma `public` ; `checkSnapshot` lève `NEON_TEST_SCHEMA_MISMATCH` si ce condensé diffère de `schemas.json` pour la version et la phase.
- Reproduction locale (PostgreSQL 16.15, 118 migrations de `main`, `readState` de #419 exécuté tel quel) : condensé **identique** au manifeste `16/118` ; après ajout d'une table `playing_with_neon (id serial primary key, name text not null, value real)` : condensé **différent**.
- Neon Test porte 576 colonnes NOT NULL contre 574 en reconstruction ; l'écart est exactement `playing_with_neon.id` et `playing_with_neon.name` (diagnostic en lecture seule du 8 novembre). La table a aussi une clé primaire et un index, donc le condensé des contraintes et des index diffère aussi.

Limites : la forme complète de la table (colonnes nullables, noms de contrainte et d'index) n'a pas été lue sur Neon (seules les colonnes NOT NULL l'ont été) ; la reproduction est faite sur PostgreSQL 16 alors que Neon Test est en 18.6 (le manifeste `18/118` n'a pas pu être rejoué ici).

## 3. Proposition : déclarer la table « connue et étrangère », sans l'ignorer

Pas d'implémentation dans cette PR : l'empreinte à épingler exige une lecture de métadonnées de cette table sur Neon Test, non autorisée à ce jour.

1. **Manifeste explicite** `scripts/neon-test/foreign-tables.json` : `{ "playing_with_neon": { "origin": "table d'exemple créée par la console Neon", "digest": "<SHA-256 de ses colonnes, contraintes et index>" } }`.
2. **`readState`** retire de `columns`, `constraints` et `indexes` les lignes des tables déclarées, puis calcule un condensé `foreign` séparé sur ces seules lignes. Les condensés `schemas.json` PG16/PG18 restent valables (ils correspondent à la reconstruction sans table étrangère, vérifié en PG16).
3. **`checkSnapshot`** exige que : `foreign` égale le condensé épinglé (sinon `NEON_TEST_FOREIGN_TABLE`) ; aucune table étrangère ne figure dans `changedColumns` ni dans la liste des tables des migrations ; aucune clé étrangère ne la relie à une table gérée dans un sens ou dans l'autre ; **toute autre table inconnue reste une divergence** `NEON_TEST_SCHEMA_MISMATCH`. Les données de la table ne sont jamais lues.
4. **Rapport** de `validate` : liste explicite « tables étrangères déclarées : playing_with_neon (condensé …) », donc visible dans les journaux. Elle n'est jamais supprimée ni modifiée.
5. **Tests** : table déclarée et conforme acceptée ; table déclarée mais modifiée (colonne en plus, index en plus) refusée ; autre table inconnue refusée ; clé étrangère vers une table gérée refusée ; table déclarée absente refusée (déclaration périmée).

**Lecture à autoriser, en lecture seule, pour épingler le condensé** (métadonnées de cette seule table, aucune ligne) : colonnes (`pg_attribute`), contraintes (`pg_constraint`) et index (`pg_index`) de `public.playing_with_neon` sur la branche de test, plus ses dépendances de clés étrangères.
