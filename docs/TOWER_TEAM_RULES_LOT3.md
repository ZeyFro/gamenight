# The Tower — règles d'équipes : préparation du lot 3

Cette branche est une proposition **non fusionnée**. Aucune migration exécutée sur Neon. Conformément au §26 :

- Capacité à la création : 2 à 8 membres, côté formulaire et validation serveur.
- Une équipe active par personne et par communauté. Index PostgreSQL unique `(communityId, userId)` sur `CommunityTeamMember`, complété par des contrôles métier dans une transaction sérialisable.
- Après un départ volontaire : `Membership.lastTeamLeftAt` impose 7 jours sans adhésion ni création d'une autre équipe dans la même communauté. En cas de dissolution, **seul le capitaine qui déclenche la dissolution** reçoit ce délai ; les autres membres sont libérés sans cooldown.
- Le capitaine actuel est représenté par `CommunityTeam.captainId`, initialisé depuis `createdById` lors de la migration. La passation modifie uniquement `captainId` : **l'identité historique du créateur reste conservée dans `createdById`**.
- L'activité du capitaine est définie provisoirement par une action de gestion du recrutement, ou par la dernière activité XP de sa communauté. Le code ne possède pas une mesure fiable du dernier login. Une passation après 30 jours se base sur le dernier événement de ces deux sources, et choisit le membre actif le plus ancien.
- La fonction `transferInactiveCommunityTeamCaptains` et la route `/api/cron/team-captain-handover` sont prévues. Route **OFF** par défaut, protégée par `CRON_SECRET`, bloquée sur Preview et, même activée, en mode simulation tant que `TEAM_CAPTAIN_HANDOVER_MODE` n'est pas exactement `execute`. Aucun cron externe n'est configuré.
- Si aucun autre membre actif n'est présent, aucune passation automatique.

## Recette à réaliser sur PostgreSQL fictif

1. Créer une équipe 2 personnes : OK ; tester 1 ou 9 personnes : refus.
2. Faire créer une deuxième équipe au même membre : refus, la première demeure.
3. Faire rejoindre deux équipes simultanément au même joueur : une seule réussit, contrainte de base conservée.
4. Quitter puis tenter de rejoindre immédiatement une autre équipe : refus.
5. Avancer fictivement `lastTeamLeftAt` de 8 jours et retenter : accepté.
6. Rendre un capitaine inactif 31 jours, ajouter deux membres et lancer le traitement en simulation : aucun changement. En mode exécution sur la **base fictive seulement**, le plus ancien devient capitaine. Le deuxième appel est sans effet.
7. Vérifier que l'ancien capitaine conserve ses données historiques, preuves et récompenses.

## Points de relecture Claude avant fusion

- `captainId` est indépendant du créateur historique. Vérifier les autres endroits du code qui présument que `createdById` est toujours le capitaine (éventuels écrans et actions hors `/equipes`).
- Les signaux d'activité ne sont pas équivalents à une connexion. Confirmer la définition de « inactif 30 jours » avant automatisation.
- Vérifier que l'index unique ne rencontre aucun doublon lors de la future migration. La base de production a actuellement zéro équipe selon le dernier audit, mais **contrôler à nouveau** au moment du déploiement.
- Les PR #362 (recherche de jeux) et ce lot modifient `src/app/equipes/page.tsx` ; synchroniser après relecture avant fusion.
- Mettre à jour toutes les documentations utilisateurs et tests sur les codes `already_team` / `cooldown`.

## Migration obligatoire avant merge

Cette PR ajoute `prisma/migrations/20261104140000_tower_team_membership_policy`. Depuis #339, le build n'applique aucune migration : **ne pas merger le code avant application contrôlée de cette migration en Production**.

Ordre obligatoire : précontrôle lecture seule des doublons `(communityId,userId)` → dry-run du runner → accord explicite propriétaire → exécution de la migration → contrôle de fin → merge de la PR.

Le runner `scripts/db-migrate.mjs` n'accepte que `MIGRATION_DATABASE_URL`, une cible attendue explicite et une liste `--expect` exacte. La connexion doit être directe et non poolée.

**Option B de lancement :** tant que Production ne possède que `neondb_owner`, le partage du rôle runtime/migration reste refusé par défaut et n'est permis que si l'opérateur ajoute explicitement `--allow-shared-role`. Le runner affiche alors `MODE DÉGRADÉ`. Immédiatement avant chaque `--execute`, un snapshot Neon frais de la branche Production doit être créé puis vérifié manuellement ; le runner rappelle cette précondition mais ne la vérifie pas via l'API.

Après le lancement, la cible est de séparer un rôle runtime limité et un rôle de migration dédié. Voir `docs/NEON_ROLE_SEPARATION_POST_LAUNCH.md`.

**Interdictions :** aucun test fonctionnel authentifié sur Preview tant que l'isolation Neon et l'interdiction des effets Discord/crons ne sont pas démontrées. Pas de migration de production ni d'activation de la passation sans accord explicite.

## Commandes opérateur — option B (préparées, non exécutées)

Utiliser un checkout propre de la tête de #370 relue par Claude. Ne pas utiliser #325. Installer les dépendances avec `npm ci`, puis `npx prisma generate` (aucune migration).

Dans une console PowerShell dédiée, fournir `MIGRATION_DATABASE_URL` par un gestionnaire de secrets ou une saisie masquée, sans écrire sa valeur dans l'historique. La valeur doit être la connexion **directe** à la branche Production, base `neondb`, rôle `neondb_owner`. Ne pas utiliser `vercel env run` : il peut injecter des URL concurrentes que le runner refuse. Ne jamais afficher l'environnement.

```powershell
$env:GAMENIGHT_EXPECTED_TARGET = '<HOTE_DIRECT_PRODUCTION>:5432/neondb'
$env:GAMENIGHT_RUNTIME_ROLE = 'neondb_owner'
node scripts/check-team-membership-duplicates.mjs
if ($LASTEXITCODE -ne 0) { throw 'Précontrôle refusé : arrêt' }
node scripts/db-migrate.mjs --expect=20261104140000_tower_team_membership_policy --allow-shared-role
if ($LASTEXITCODE -ne 0) { throw 'Dry-run refusé : arrêt' }
```

Remplacer l'hôte attendu après vérification indépendante dans Neon. Le précontrôle doit afficher 0 doublon et le dry-run exactement une migration attendue. Toute migration inattendue, inachevée ou absente du checkout impose un arrêt ; ne pas élargir `--expect` pour contourner le refus.

**Point d'arrêt :** consigner le SHA relu, la cible, le résultat du précontrôle et du dry-run. Obtenir l'accord d'exécution ; créer et vérifier un snapshot Production frais immédiatement avant la commande suivante (identifiant, heure UTC, bonne branche, état disponible). Cette vérification reste manuelle. Si l'exécution est différée, refaire le snapshot et les contrôles.

```powershell
node scripts/db-migrate.mjs --expect=20261104140000_tower_team_membership_policy --allow-shared-role --execute --confirm-database=neondb
if ($LASTEXITCODE -ne 0) { throw 'Échec ou contrôle incomplet : ne pas relancer ni merger' }
node scripts/check-team-membership-duplicates.mjs
if ($LASTEXITCODE -ne 0) { throw 'Contrôle final refusé : ne pas merger' }
Remove-Item Env:MIGRATION_DATABASE_URL -ErrorAction SilentlyContinue
```

Exiger le message final du runner « aucune en attente » et 0 doublon avant de considérer la migration validée. Un nouveau dry-run avec la migration déjà appliquée renvoie volontairement 2 (« Rien à faire »), pas 0. Aucune restauration Production, aucun `migrate resolve`, aucun merge ni redéploiement n'est inclus dans ces commandes.
