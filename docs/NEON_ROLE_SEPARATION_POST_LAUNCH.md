# Neon — rôle partagé au lancement puis séparation des rôles

## État actuel vérifié le 4 novembre 2026

- Projet Neon : `misty-tooth-45335023`.
- Branche Production : `production` (`br-super-cell-b1ukvk08`).
- Base : `neondb`.
- Hôte direct : `ep-morning-wind-b17jd40o.c-5.eu-central-1.aws.neon.tech`.
- Un seul rôle PostgreSQL existe actuellement : `neondb_owner`.
- Le `DATABASE_URL` Vercel Production est un secret décrit comme connexion Neon Production poolée.

Aucune modification de rôle n'est effectuée par cette procédure.

## Option B — lancement avec rôle partagé

Le runner refuse toujours par défaut que le rôle de migration soit aussi le rôle runtime. Pour la période de lancement uniquement, l'opérateur peut ajouter explicitement `--allow-shared-role`.

Avant **chaque** `--execute` sur Neon Production :

1. créer un snapshot frais de la branche `production` ;
2. vérifier qu'il apparaît bien dans la liste des snapshots avec la bonne branche source et un horodatage immédiatement antérieur à l'opération ;
3. conserver son identifiant dans le compte-rendu de maintenance ;
4. seulement ensuite lancer le runner.

Cette vérification reste **humaine et procédurale** : `db-migrate.mjs` ne consulte pas l'API Neon. Il affiche un rappel avant l'exécution.

Exemple pour la migration équipes, après le précontrôle des doublons et après vérification du snapshot :

```powershell
$env:MIGRATION_DATABASE_URL = Read-Host "URL DIRECTE Neon de neondb_owner"
$env:GAMENIGHT_EXPECTED_TARGET = "ep-morning-wind-b17jd40o.c-5.eu-central-1.aws.neon.tech/neondb"
$env:GAMENIGHT_RUNTIME_ROLE = "neondb_owner"

node scripts/db-migrate.mjs --expect=20261104140000_tower_team_membership_policy --allow-shared-role
```

Après accord explicite du propriétaire, **et uniquement si un snapshot frais vient d'être vérifié** :

```powershell
node scripts/db-migrate.mjs --expect=20261104140000_tower_team_membership_policy --allow-shared-role --execute --confirm-database=neondb
```

Le message `MODE DÉGRADÉ` est attendu. Toute migration inattendue, migration inachevée, mauvaise cible ou absence de confirmation reste bloquante.

## Après le lancement — séparation prévue

Objectif : ne plus utiliser `neondb_owner` comme identité applicative quotidienne.

Plan, sans exécution :

1. inventorier les droits réellement nécessaires au runtime GameNight ;
2. créer un rôle runtime dédié limité à `neondb` et au schéma applicatif, sans droits DDL ;
3. conserver un rôle de migration distinct avec les droits nécessaires aux migrations Prisma ;
4. tester les deux rôles sur une branche Neon isolée ;
5. basculer `DATABASE_URL` Vercel Production vers le rôle runtime ;
6. redéployer et valider authentification, lectures et écritures applicatives ;
7. utiliser uniquement le rôle migration via `MIGRATION_DATABASE_URL` lors des fenêtres de migration ;
8. retirer `--allow-shared-role` des procédures normales.

La création des rôles et la bascule Vercel nécessitent un accord explicite séparé.
