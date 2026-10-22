# Plan de maintenance : bascule `xpBalance` (#291)

Document de préparation. Il n'autorise aucune opération Production ; le protocole détaillé (rôles, barrière, récupération) reste dans [XP-ROLLOUT-DECISION-20261019.md](XP-ROLLOUT-DECISION-20261019.md). Les durées sont des **estimations** : aucune mesure Production n'existe.

## Outils (locaux uniquement)

- `node scripts/xp-balance-bascule.mjs` : dry-run par défaut ; `--execute --confirm-database=<base>` pour appliquer. Refuse toute base hors `gamenight_xp_*` et tout conteneur non lié à `127.0.0.1`. Idempotent : base déjà basculée = aucune écriture (jamais de recopie `xpBalance = xpTotal`). Refus sans écriture si `xpTotal < 0`, migration en échec ou état partiel.
- `node scripts/rehearse-xp-balance-bascule.mjs` : répétition complète sur copies jetables (données synthétiques, dump, restauration, bascule, relance, cas négatif et partiel).
- Pour Production, ces scripts ne servent pas de lanceur : l'opérateur exécute les étapes 4 à 7 avec le rôle de migration (`npx prisma migrate deploy`) et reprend les mêmes contrôles en SQL lecture seule.

## Étapes et durée estimée

| # | Étape | Durée |
|---|-------|-------|
| 1 | Préchecks lecture seule (comptes, négatifs, migrations en échec), SHA #291 vert (`verify` + Preview) et intégré au `main` courant | 10 min |
| 2 | Barrière d'écriture sur anciens et nouveaux runtimes, crons externes coupés, `pg_stat_activity` vérifié | 15 à 30 min |
| 3 | Dump `-Fc` + checksum, restauration dans une cible isolée, empreinte comparée à la source | 5 min (12 lignes connues le 20/10, à reconfirmer) |
| 4 | `prisma migrate deploy` (2 migrations : colonne + contrainte, puis valeur d'enum) | < 1 min, verrou court sur `CommunityMemberStats` |
| 5 | Contrôles SQL : migrations terminées, `xpBalance = xpTotal`, aucun solde négatif, empreinte progression/équipements/objets/ledger identique | 5 min |
| 6 | Déploiement du build #291 (sans migration), droits DML rendus au seul nouveau runtime | 5 à 10 min |
| 7 | Réouverture, surveillance des erreurs runtime | 30 min |

Total estimé : 1 h 15 à 1 h 30, dominé par la barrière (étape 2).

## Critères de repli

- Précheck en échec (négatif, migration en échec, historique inattendu) : ne pas démarrer, ne rien corriger automatiquement.
- Dump non restaurable ou empreinte différente : arrêt avant la migration, maintenance maintenue.
- Migration en échec : garder la maintenance, conserver les traces, restaurer le dump dans une **autre** cible ; pas de `migrate resolve` sans revue.
- Empreinte ou soldes non conformes à l'étape 5 : ne pas rouvrir ; restaurer le dump (aucune écriture acceptée depuis le snapshot grâce à la barrière).

## Critères de réouverture

Les trois conditions : migrations XP terminées une seule fois et aucune inachevée ; `xpBalance = xpTotal` pour toutes les lignes, aucun solde négatif ; empreinte identique à l'étape 3. Après réouverture, ne jamais rétablir `xpTotal = xpBalance` ni recopier `xpBalance = xpTotal` : corriger par une nouvelle correction applicative.
