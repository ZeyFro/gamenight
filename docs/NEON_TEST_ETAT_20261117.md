# État factuel — Neon Test et pile Tower — 17 novembre 2026

> Constats datés, pas des preuves de production. Aucune migration, aucune restauration et aucune
> action Discord n'a été exécutée pour produire ce document. Les valeurs sensibles ne sont pas
> reproduites ici.

## 1. Cible Neon Test

| Élément | Valeur | Source |
| --- | --- | --- |
| Hôte attendu par les workflows | `ep-morning-wave-b1o2tpej.c-5.eu-central-1.aws.neon.tech/neondb` | `.github/workflows/neon-test-migrations.yml`, `neon-test-apply.yml` |
| Branche documentée | `tower-migration-test-20261105` (`br-snowy-snow-b1cggq2w`), non primaire, non par défaut | `docs/ETAT.md`, `docs/PLAN-MIGRATIONS.md` |
| Sauvegarde annoncée | `backup-tower-migration-test-20261106` (`br-purple-mud-b1nt0tfi`), parent de la cible, point `0/2A355C30`, état `ready` au 6/11 | `docs/PLAN-MIGRATIONS.md` |

**Limite du relevé du 17/11 :** aucun client Neon n'est installé localement (`neonctl` absent) et
`MIGRATION_DATABASE_URL` n'est pas présent dans l'environnement de travail. Les métadonnées de
branche et de sauvegarde ci-dessus restent donc celles du 6 novembre : elles ne sont **pas**
revérifiées à la date du jour. La vérification en direct ne peut se faire que par le workflow
protégé, qui porte le secret.

## 2. Migrations en attente et ordre

| Ordre | Migration | Portée | SHA-256 |
| --- | --- | --- | --- |
| 1 | `20261104140000_tower_team_membership_policy` | #370 | `9f642e6200bef888669e9c058bf1623ad582cd2772ea5e433a7b78bfa596db8f` |
| 2 | `20261105120000_tower_launch_channels_appeals_matchmaking` | #406 | `e7782519fcdf5e9637f131fbd348ceb07c8f6f177dbe87f82ba9a18f6c94a9de` |

**Contrôle réalisé le 17/11 :** les checksums calculés aux SHAs épinglés dans les workflows
(`4a18b74` pour #370, `1a495ed` pour #406) sont **identiques** à ceux des têtes actuelles des PR.
Le dry-run porte donc bien le contenu qui sera fusionné, sans écart de source à corriger.

**Dernier relevé machine disponible :** run `43398418354` du 13 novembre 2026, conclusion `success`,
`OPERATION: validate` — le journal affiche « À appliquer : `20261104140000_tower_team_membership_policy` »
puis « DRY-RUN : aucune écriture ». Autrement dit, au 13/11 la migration #370 était **encore en
attente** et rien n'a été appliqué. C'est le relevé le plus récent, pas une preuve de l'état du jour.

Deux runs antérieurs du même workflow sont en échec (`43388116969`, `43391940334`) ; leurs journaux
consultables s'arrêtent sur le nettoyage des checkouts et n'exposent pas la cause utile. À rejouer
plutôt qu'à interpréter.

### Dry-run exécuté le 17 novembre

| Élément | Résultat |
| --- | --- |
| Run GitHub | `44077998286`, workflow `neon-test-migrations.yml`, `main` à `711e31d` |
| Heure | déclenché 11:53:01 UTC, terminé en succès vers 11:55 UTC (~90 s de job) |
| Approbation | environnement `neon-migration-test`, réviseur `ZeyFro`, approuvé pour ce run uniquement |
| Opération | `dry-run` (seule option du workflow, zéro occurrence de `--execute`) |
| Cible validée | `ep-morning-wave-b1o2tpej.c-5.eu-central-1.aws.neon.tech:5432/neondb`, rôle `gamenight_test_migrator` |
| Projet et branche | `misty-tooth-45335023`, branche `br-snowy-snow-b1cggq2w` |
| Rôles | migration `gamenight_test_migrator`, runtime `neondb_owner`, distincts, TLS strict |
| Migrations en attente | **2**, dans l'ordre, checksums conformes |
| Divergence | **aucune** avec les contrôles du 6 et du 13 novembre |

Le préflight a validé, dans une transaction `SET TRANSACTION READ ONLY` : identité de projet et de
branche, rôle non superuser sans `CREATEDB`/`CREATEROLE`/`REPLICATION`/`BYPASSRLS`, aucune adhésion,
propriété DDL des cinq tables de la migration et de l'enum `UserNotificationCategory`, les onze
privilèges requis, et l'absence de doublon membre ou de créateur orphelin.

**Nuance de lecture :** le préflight valide l'identité en dur mais n'imprime pas les identifiants ;
« projet et branche » ci-dessus viennent des contrôles du script, pas d'une ligne de journal.

**Écart avec le run du 13 novembre :** ce jour-là, seule `20261104140000` apparaissait, parce que le
workflow d'application n'assemble que la première migration. Le workflow de dry-run assemble les deux :
la liste à deux entrées est la normale, pas une régression.

## 3. Restauration

Aucune restauration n'a été exécutée ni éprouvée à ce jour. La sauvegarde existe et était `ready`
au 6/11, mais **son exploitabilité n'est pas démontrée**. Le workflow d'application refuse
d'ailleurs de continuer sans champ `restoration_evidence` renseigné.

**Existence non revérifiée le 17/11 :** sans client Neon ni clé API dans cet environnement, impossible
de relire l'état de `backup-tower-migration-test-20261106` (`br-purple-mud-b1nt0tfi`). La vérification
revient au propriétaire ou à un run disposant d'un accès lecture seule.

### Procédure de restauration testable (préparée, non exécutée)

Objectif : prouver que la sauvegarde est restaurable **sans toucher Production**, sur une branche
jetable, avec nettoyage contrôlé.

Prérequis bloquants :

- Un emplacement de branche libre (10 branches utilisées au dernier relevé ; aucune création ni
  suppression ne doit être improvisée pour faire de la place).
- Un accès Neon du propriétaire, ou une clé API en lecture/écriture de branche fournie hors chat.
- Aucune cible Vercel, aucun cron et aucun bot ne doit pointer vers la branche restaurée.

Étapes :

1. Relever en lecture seule l'état de la sauvegarde : parent, point de restauration, rétention, horodatage.
2. Créer `restore-check-20261117` **depuis ce point uniquement** (jamais « Restore production »).
3. Contrôles : identité projet/branche de la copie, nombre d'entrées `_prisma_migrations` et dernière
   entrée terminée, présence des cinq tables et de l'enum exigés par le préflight, agrégats
   doublons/orphelins à zéro.
4. Test d'écriture isolé dans la copie (insertion suivie d'un `ROLLBACK`) pour vérifier que la branche
   accepte des écritures sans effet durable.
5. Rapport de preuve daté : heure UTC, identifiants de branche, résultats des contrôles, sans aucun secret.
6. Nettoyage : supprimer **uniquement** la branche jetable, après accord séparé, et conserver la
   sauvegarde et la branche cible intactes.

Critère de réussite : la copie est lisible, son schéma et son historique sont cohérents, l'écriture
fonctionne et la Production n'a pas été touchée. Échec : arrêt immédiat, aucune suppression, aucun
contournement par une nouvelle branche créée d'autorité.

### Tentative du 17 novembre — bloquée par le quota de branches

Préflight vérifié **en direct** via l'API Neon (CLI officiel, profil `DEFAULT`) :

| Contrôle | Résultat |
| --- | --- |
| Projet | `misty-tooth-45335023` (`gamenight`), PostgreSQL 18, région `aws-eu-central-1` |
| Branche cible de test | `br-snowy-snow-b1cggq2w` = `tower-migration-test-20261105`, `ready`, non primaire, non par défaut |
| Sauvegarde | `br-purple-mud-b1nt0tfi` = `backup-tower-migration-test-20261106`, **`ready`**, non primaire |
| Parent de la sauvegarde | `br-snowy-snow-b1cggq2w` — correspond à la cible annoncée |
| Point de restauration | `parent_lsn 0/2A355C30`, `parent_timestamp 2026-11-06T12:26:10Z` |
| Création de `restore-check-20261117` | **refusée par l'API : `branches limit exceeded`** |

Inventaire du projet : **10 branches, limite atteinte**. Quatre actives (`production`,
`tower-migration-test-20261105`, `tower-restore-rehearsal-20261107`,
`backup-tower-migration-test-20261106`) et six archivées (`backup-avant-tower-migrations-20261030`,
`tower329-isolated-snapshot-20261020`, `xp291-restored-proof-20261020`, `xp291-endpoint-repair-20261020`,
`portable1-recette-20261019`, `backup-avant-multiserveur`).

Aucune branche n'a été créée, supprimée, réinitialisée ou modifiée. Aucun apply. Aucun jeton affiché.

**Déblocage possible, sur décision explicite :** supprimer une branche archivée (irréversible), ou
relever la limite du projet. Une suppression n'a pas été tentée.

**Précision sur la répétition du 14/11 :** le projet voisin `winter-scene-14323342`
(`gamenight-restore-rehearsal-20261114`) contient six branches créées le même jour depuis sa propre
timeline (`parent_lsn 0/19DBC68`). C'est une répétition synthétique sur un projet séparé, **pas** une
restauration de `br-purple-mud-b1nt0tfi` ; elle ne constitue donc pas la preuve demandée.

## 4. Garde-fous GitHub constatés

- Environnement `neon-migration-test` : `required_reviewers` **et** `branch_policy` → chaque exécution
  attend une approbation humaine dans l'interface GitHub.
- Les deux workflows ne s'exécutent que si `github.ref == refs/heads/main`.
- `neon-test-apply.yml` exige en plus `confirmation=APPLY-370-406-ON-TEST`, un `dry_run_id` de moins
  de 24 h en `SUCCESS`, et la variable `NEON_TEST_APPLY_AUTHORIZATION`.
- `gh secret list` et `gh variable list` ne renvoient aucun nom avec les droits actuels : l'absence
  n'est pas prouvée, les valeurs sont probablement définies au niveau de l'environnement.

## 5. Pile Tower — état au 17 novembre

| PR | Branche | Checks | Migration |
| --- | --- | --- | --- |
| #370 | `feat/tower-team-rules-20261104` | tous verts, Vercel Preview inclus | oui |
| #406 | `codex/tower-pr-notifs-20261105` | tous verts, Vercel Preview inclus | oui |
| #407 | `codex/tower-pr-preuves-20261105` | `verify`, `rules`, `storage` verts ; Vercel Preview en échec (quota, non requis) | `20261106150000` locale, hors périmètre autorisé |
| #408 | `codex/tower-pr-equipes-20261105` | idem #407 | héritée de #406 |
| #416 | `codex/team-command-manifest-20261105` | `verify-team-command` vert ; Vercel Preview en échec | héritée de #406 |

`git merge-tree` contre `main` (`34da05a`) : **exit 0** pour les cinq branches, aucun conflit.

## 6. Opérations qui nécessitent une autorisation explicite

Aucune n'a été exécutée.

### A. Dry-run du workflow #419 (lecture seule, connexion au secret)

```sh
gh workflow run neon-test-migrations.yml --ref main -f operation=dry-run
gh run watch <id>            # l'environnement demande une approbation dans GitHub
```

Effet : lecture de l'identité de la cible, des droits DDL du rôle dédié, de l'historique
`_prisma_migrations` et de la liste en attente. Aucune écriture. **Nécessite ton accord** et ton
approbation de l'environnement.

### B. Validation puis application sur Neon Test

```sh
gh workflow run neon-test-apply.yml --ref main -f operation=validate -f dry_run_id=<run dry-run SUCCESS < 24 h>
# puis, après accord distinct :
gh workflow run neon-test-apply.yml --ref main -f operation=apply \
  -f dry_run_id=<...> -f confirmation=APPLY-370-406-ON-TEST \
  -f restoration_evidence="<commentaire #400 + preuve de restauration>"
```

Conditions à remplir avant `apply` : restauration éprouvée, variable `NEON_TEST_APPLY_AUTHORIZATION`
présente, accord nommant le fichier et la cible. #370 est appliquée seule par ce workflow ; #406 exige
un second passage après contrôle à 119 migrations.

### C. Hors autorisation actuelle

Production : aucune préparation d'exécution, aucun snapshot, aucun `apply`. Cela reste une décision
distincte, après validation complète sur Neon Test.
