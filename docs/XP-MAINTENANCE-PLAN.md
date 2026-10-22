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

## Constats Production du 22 octobre (lecture seule, aucune opération)

Établis par `SELECT` sur `pg_roles`, `pg_stat_activity` et `_prisma_migrations`, sans texte de requête ni donnée utilisateur :

- **Cible** : projet Neon `misty-tooth-45335023`, branche par défaut `production` (`br-super-cell-b1ukvk08`), base `neondb`. Dernière migration appliquée : `20261020110000_tournament_team_bracket`, aucune annulée ; `main` n'en porte pas d'autre.
- **Binding Vercel → Neon : NON PROUVÉ.** `DATABASE_URL` est `sensitive` (valeur illisible), cible `production` seule, inchangée depuis le 14 septembre. Indice historique seulement : deux builds Production du 20 octobre ont appliqué leur migration sur cette base (`finished_at` 08:24:15Z et 08:52:15Z, déploiements `success` à 08:25:36Z et 08:53:24Z). Cette corrélation d'horaires ne prouve ni le binding actuel, ni celui du runtime des fonctions (variable distincte à l'exécution), ni qu'aucun autre écrivain n'utilise la base. Preuve attendue avant la fenêtre : lecture de la destination par un accès Vercel autorisé, ou test canari contrôlé sous barrière (écriture refusée avec les identifiants du runtime).
- **Rôles** : un seul rôle de connexion applicatif existe, `neondb_owner` (propriétaire, `BYPASSRLS`, `CREATEROLE`, `INSERT`/`UPDATE` et `CREATE` sur `public`), plus les rôles de plateforme `cloud_admin` (superutilisateur) et `neon_service`. Il n'y a **ni rôle runtime ni rôle de migration distincts**. La barrière « bascule de rôle » du protocole n'est donc pas exécutable avec les rôles actuels : elle suppose de créer des rôles ou de réinitialiser le mot de passe, c'est-à-dire des écritures Production à autoriser séparément.
- **Connexions** (instantané, non probant) : une session `neondb_owner` via `pgbouncer` (la requête de contrôle elle-même) et deux sessions de plateforme `cloud_admin`. Une absence de session ne prouve pas l'arrêt des writers : le pooler recycle les connexions.
- **Writers à couper** (inventaire du code, à confirmer côté exploitation) : requêtes web authentifiées et server actions, callbacks Steam et Discord, `api/discord/interactions` et `api/discord/webhook-events`, routes `api/cron/*` (`close-sessions`, `community-guild-sync`, `discord-thread-cleanup`, `free-game-discord`, `monthly-tasks`, `notification-executor`, `refresh-discord-profiles`, `reminders`, `retention-cleanup`, `steam-library-full-sync`, `steam-library-sync`), `api/backfill/*` (`game-news`, `igdb-coop`, `seed-reconcile`, `steam-store`), tâches `after()` déjà lancées, et le worker vocal (non installé). Les déclencheurs externes (cron-job.org) ne sont visibles ni du dépôt ni du connecteur : leur configuration est à fournir.
- **Manquants** : configuration du service de cron externe, journaux d'exécution Vercel (403), comptes et taille actuels de `CommunityMemberStats` (le dernier relevé date du 20 octobre : 12 lignes, 96 kB), snapshot Neon frais, mesure de durée.
