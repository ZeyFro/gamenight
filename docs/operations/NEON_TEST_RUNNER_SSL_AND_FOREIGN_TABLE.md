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

## 2. `playing_with_neon` : origine et résolution du comptage 574/576

Le comptage initial incluait toutes les tables ordinaires de `public` dans le condensé géré. Sur Neon Test, deux colonnes NOT NULL supplémentaires venaient de la table d’exemple `public.playing_with_neon` : `id` et `name`. Elles expliquent 576 contraintes NOT NULL au total, contre 574 dans la reconstruction des migrations applicatives. Ce n’est pas un écart inexpliqué du schéma géré.

La reproduction PostgreSQL16 décrite lors du diagnostic initial montrait que l’ancien calcul du condensé changeait si cette table était ajoutée. Le code actuel déclare cependant cette table étrangère avec son empreinte PostgreSQL18, l’exclut du condensé géré tout en contrôlant séparément son identité structurelle, et refuse toute autre table inconnue. Voir le mécanisme et les tests en section 3. Aucune ligne de `playing_with_neon` n’est lue, modifiée ou supprimée.

**Limite restante :** les métadonnées de cette table ont été relevées en lecture seule sur Neon Test (PostgreSQL18.6), mais la validation complète du condensé géré `18/118` n’a pas été exécutée sur Neon. Le mode `validate` exact reste nécessaire après revue et intégration ; aucune différence supplémentaire ne devra être normalisée ou ignorée sans diagnostic.

## 3. Table étrangère connue : implémentée

**Lecture seule faite le 8 novembre** (transaction `READ ONLY`, branche `br-snowy-snow-b1cggq2w` uniquement, métadonnées de `public.playing_with_neon`, aucune ligne lue ; PostgreSQL 18.6, 118 migrations) : colonnes `id integer` (défaut `nextval('playing_with_neon_id_seq')`, NOT NULL), `name text` NOT NULL, `value real` nullable ; contraintes NOT NULL sur `id` et `name` et clé primaire `playing_with_neon_pkey` ; un index unique `playing_with_neon_pkey` ; **aucune clé étrangère, aucun déclencheur, aucune règle, aucune vue dépendante** ; séquence propre `playing_with_neon_id_seq` ; propriétaire `neondb_owner`.

**Mécanisme** (`scripts/neon-test/state.mjs`, `run.mjs`, `foreign-tables.json`) :

1. `foreign-tables.json` déclare chaque table étrangère avec son origine et son condensé SHA-256 **par version majeure** (colonnes, contraintes, index, représentation canonique en chaînes, indépendante du pilote). Seule `playing_with_neon` est déclarée, épinglée pour PostgreSQL 18.
2. `readState` retire ces tables des listes `columns`, `constraints` et `indexes` avant de calculer `schema` : les condensés de `schemas.json` restent ceux du schéma sans table étrangère (inchangés ; reproduction PostgreSQL 16 sur la base de test). Les requêtes du condensé géré ne sont pas modifiées.
3. Il calcule séparément le condensé de chaque table déclarée et relève toute clé étrangère entre une table déclarée et une autre table, dans un sens ou dans l'autre.
4. `checkSnapshot` appelle `checkForeignTables` : refus `NEON_TEST_FOREIGN_TABLE` si la table est modifiée (colonne, contrainte, index, type, défaut), absente (déclaration périmée), non épinglée pour cette version, reliée par clé étrangère à une table gérée, ou si elle porte le nom d'une table gérée. **Toute autre table inconnue reste une divergence `NEON_TEST_SCHEMA_MISMATCH`.**
5. `validate` consigne chaque table déclarée et son condensé dans le journal (« Table étrangère déclarée et conforme… »). La table n'est jamais supprimée ni modifiée ; ses lignes ne sont jamais lues.

**Tests.** `src/lib/neon-test-foreign-tables.test.ts` (14 : condensé reproductible depuis les métadonnées lues, canonique, sensible à 7 modifications, exclusion du condensé géré, table inconnue toujours refusée, refus de modification / absence / version non épinglée / clé étrangère / nom d'une table gérée, enchaînement de `checkSnapshot`) ; `src/lib/neon-test-foreign-tables.integration.test.ts` (catalogue PostgreSQL réel, base jetable : condensé géré identique avec et sans la sonde déclarée, sonde épinglée, lignes jamais lues, modification, clé étrangère et absence refusées). Trois mutations du code (ne plus exclure, accepter un condensé différent, ignorer les clés étrangères) font échouer les tests.

**Pour ajouter ou repérer une autre table étrangère** : relire ses métadonnées en lecture seule avec les requêtes de `readState` filtrées sur son nom, calculer `foreignDigest` (exporté par `state.mjs`) et l'ajouter au manifeste dans une PR relue.

**Limites.** Non vérifié : le condensé géré complet de Neon Test (PostgreSQL 18) face au manifeste `18/118`, car seules les métadonnées de cette table ont été lues ; le premier `validate` réel dira s'il existe d'autres écarts. Le condensé épinglé vient de lignes lues par le connecteur Neon (types convertis en chaînes) et n'a pas été rejoué par `readState` sur Neon ; si une divergence de représentation existait, `validate` refuserait (`NEON_TEST_FOREIGN_TABLE`), sans jamais accepter à tort.
