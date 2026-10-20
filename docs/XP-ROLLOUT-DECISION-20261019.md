# Décision de publication de #291 — aucune opération Production exécutée

PR : https://github.com/ZeyFro/gamenight/pull/291. Elle reste en brouillon. Le 2026-10-20, la branche a intégré `origin/main` `7a06131` par merge; les contrôles de cette nouvelle tête sont à refaire par CI. Cette note prépare une autorisation ; elle ne l'accorde pas.

## Opération soumise à autorisation

Autoriser une fenêtre de maintenance avec arrêt vérifié de **tous** les writers, une sauvegarde Production effectivement restaurable, l'application séparée de **l'unique migration XP attendue `20261019190000_separate_xp_balance`**, puis le déploiement du code #291 basé sur `main` `7a06131`. Le build de main exécute `prisma migrate deploy` avant Next. Dans cette PR, `scripts/build.mjs` exécute uniquement `prisma generate` puis Next; la migration se fait séparément avec un rôle distinct. La fusion reste interdite avant la barrière, la sauvegarde restaurée et une autorisation spécifique. Reconfirmer la migration en attente depuis le nouveau checkout juste avant d'autoriser l'opération.

Le SQL exact, inchangé, est dans `prisma/migrations/20261019190000_separate_xp_balance/migration.sql` (SHA-256 `c5767cde21cb3b03bf89ff110c2d87f528a9483a010c4b5782e67cf2fd86d754`) : ajout de `CommunityMemberStats.xpBalance INTEGER NOT NULL DEFAULT 0`, copie de `xpTotal` dans chaque solde, puis contrainte `xpBalance >= 0`. Il n'y a ni DROP, ni suppression d'objet, ni recalcul de grade, ni écriture Discord.

Cette autorisation ne couvre pas une restauration destructive après réouverture, une modification des montants de pénalité, des flags globaux ou une recette qui écrit en Production. Le rôle applicatif et le moyen d'arrêt des anciens writers doivent être identifiés par l'opérateur avant de programmer la fenêtre ; ils ne sont pas présumés dans cette session.

## Impact sur les données et les grades

- `xpTotal` reste inchangé à la migration : niveaux, grades et titres dérivés conservent leur valeur actuelle. Les anciennes dépenses qui avaient déjà abaissé la progression ne sont pas remboursées ; leur reconstitution depuis le ledger serait incomplète.
- Le nouveau solde initial est la progression actuelle, par membre **et** communauté. Les nouveaux membres commencent à zéro. Objets achetés, équipements, séries, badges et historiques ne sont pas modifiés par le SQL.
- Les prochains achats débitent seulement `xpBalance`. Les gains créditent progression et solde ; équipement/retrait ne coûtent rien. Les paris conservent leur effet historique sur la progression et utilisent le solde disponible. Corrections admin et pénalités gardent leurs montants et plafonnent le solde à zéro. Le reset saisonnier remet les deux compteurs à zéro et conserve les objets.
- Les événements `SHOP_PURCHASE` restent au ledger pour tracer la dépense, mais sont exclus des agrégats de progression. Aucun montant de pénalité n'a été changé.
- La migration met à jour toutes les lignes et prend des verrous. La durée sur les données Production est inconnue : les dix lignes synthétiques ne constituent pas un benchmark du volume réel.

## Précontrôles Production à faire en lecture seule par l'opérateur

```sql
SELECT count(*) AS membres_communautes, min("xpTotal") AS xp_min,
       max("xpTotal") AS xp_max,
       count(*) FILTER (WHERE "xpTotal" < 0) AS valeurs_negatives
FROM "CommunityMemberStats";
SELECT pg_size_pretty(pg_total_relation_size('"CommunityMemberStats"'));
SELECT migration_name, finished_at, rolled_back_at
FROM _prisma_migrations
WHERE finished_at IS NULL AND rolled_back_at IS NULL;
```

Conditions : aucune progression négative, aucune migration en échec, seule la migration XP attendue manque par rapport au checkout approuvé. Capturer les comptes et une empreinte ordonnée des clés/progressions/équipements, ainsi que le nombre d'objets, avant/après sous arrêt des écritures. Si une condition échoue, ne pas fusionner ni corriger des données automatiquement.

### Résultat de la lecture seule du 2026-10-20

- Neon MCP : projet `gamenight` (`misty-tooth-45335023`), branche par défaut `production` (`br-super-cell-b1ukvk08`), base `neondb`. Neon signale `protected=false`; aucune protection ou configuration de branche n'a été changée.
- `CommunityMemberStats`: 12 lignes, `xpTotal` min 0/max 728, 0 valeur négative; taille totale 96 kB. La colonne `xpBalance` est absente.
- `_prisma_migrations`: 111 lignes, 111 terminées, 0 en échec/inachevée. Les 111 migrations du `main` `7a06131` sont donc présentes par nombre; `20261019190000_separate_xp_balance` est absente. Le contrôle des noms doit être répété avec le checkout final avant l'opération.
- Un seul groupe de session visible dans `pg_stat_activity` correspondait à la requête Neon `pgbouncer`. Cette observation est instantanée, inclut la session de contrôle et **ne prouve ni l'arrêt ni l'inventaire des writers**.
- `pg_roles` montre les logins `cloud_admin`, `neon_service`, `neondb_owner`; rôle runtime distinct, rôle de migration distinct, leurs grants et l'identité du pooler applicatif ne sont pas établis.
- Vercel env list en mode `decrypt=false` a renvoyé HTTP 403 pour le scope du projet. Aucune valeur n'a été lue; impossible de prouver que `DATABASE_URL` du runtime Vercel pointe sur cette base.
- Aucun dump Production n'a été créé et aucune restauration isolée de données Production n'a été tentée.

Ces résultats satisfont seulement les précontrôles de données et de schéma à cet instant. Ils ne remplacent pas la vérification juste avant la fenêtre et ne prouvent pas le verrouillage, les rôles, la sauvegarde ou la durée.

## Séquence de bascule à faire autoriser

1. Enregistrer le commit et le déploiement Production courants, confirmer via l'environnement Vercel autorisé que le runtime pointe sur le projet Neon/la branche/la base ci-dessus, et identifier le rôle utilisé par chaque writer : web, actions, callbacks Discord, crons et jobs déjà lancés. Vérifier les privilèges d'un compte de migration distinct. L'accès Vercel 403 actuel ne permet pas cette preuve. Ne changer aucune protection Vercel.
2. Établir une barrière d'écriture vérifiée pour **anciens et nouveaux runtimes**, y compris URL directes, callbacks, crons et tâches déjà lancées. Une option est une bascule de rôle : désactiver l'ancien accès et terminer ses connexions ; donner au nouveau runtime uniquement des droits de lecture jusqu'à l'étape 6. Le rôle de migration est distinct et n'est jamais injecté au runtime. Cela peut rendre les pages indisponibles pendant la fenêtre. Les commandes de rôles ne peuvent être fixées avant identification de leurs propriétaires, privilèges et poolers. Une simple pause de l'interface ou des crons est insuffisante.
3. Une fois les anciens writers arrêtés et les requêtes en cours drainées, prendre un dump complet au format custom et enregistrer son checksum, son horodatage et le point de restauration fournisseur disponible. Conserver la sauvegarde hors dépôt et ne supprimer aucune branche Neon. Restaurer cette sauvegarde dans une cible isolée avant de la considérer utilisable. `pg_dump` fournit un snapshot cohérent mais n'empêche pas de nouvelles écritures : la barrière de l'étape 2 reste indispensable ([PostgreSQL 16](https://www.postgresql.org/docs/16/app-pgdump.html)).
4. Sur le checkout approuvé, appliquer `npx prisma migrate deploy` avec le rôle de migration et la cible Production vérifiée, puis déployer avec le build de cette PR (`prisma generate` puis Next, sans migration) et le rôle runtime toujours sans DML. Ne pas exécuter de seed, de backfill ni de migration supplémentaire. Garder l'ancien accès désactivé ; même après promotion, le nouveau runtime ne peut pas écrire avant l'étape 6.
5. Avant de réouvrir : vérifier en SQL avec un accès de lecture la migration terminée, `xpBalance = xpTotal`, soldes non négatifs, progression/équipements/objets identiques au snapshot. Ne pas naviguer vers des pages authentifiées comme recette Production : `getCurrentUser()` peut appeler `touchStreak` et `checkTemporalBadges`, même sur un GET. Les écrans, achats et notifications sont vérifiés exclusivement en local avec vrais services externes bloqués.
6. Après ces preuves et la validation de la barrière, accorder les droits applicatifs uniquement au nouveau runtime. Ne pas réactiver l'ancien accès. Le redémarrage des automatisations Discord n'est pas une recette de cette opération et ne doit pas servir à envoyer un message réel de validation. Ne pas remettre le build historique tant qu'il utiliserait un compte runtime sans privilèges de migration.

La session n'a ni identifié les rôles Production ni établi cette barrière. Tant que ces prérequis externes manquent, **le plan est reviewable mais la fusion reste interdite**.

## Récupération

- **Échec avant réouverture des écritures :** garder la maintenance. Inspecter l'historique Prisma et conserver les traces. Restaurer la sauvegarde dans une autre cible isolée, vérifier empreintes/objets, puis remettre l'ancien code sur la base restaurée. Avec une barrière tenue depuis le snapshot, aucun événement post-snapshot n'a été accepté. Ne supprimer aucune base ou branche à chaud.
- **Échec de migration sur une donnée négative :** l'essai réel avec Prisma **6.19.3** a annulé les changements SQL, mais laissé une ligne de migration en échec. Ne pas relancer aveuglément ni utiliser `migrate resolve` sans revue de l'état exact. Ne pas modifier une migration publiée.
- **Après réouverture :** privilégier une correction applicative qui conserve tous les nouveaux writers XP. Revenir à l'ancien code seul désynchroniserait le solde. Restaurer le snapshot effacerait aussi toutes les autres écritures postérieures, pas seulement les achats : c'est une décision de perte de données distincte, non autorisée ici.
- Ne jamais rétablir `xpTotal = xpBalance` (perte de progression) ni recopier `xpBalance = xpTotal` après les nouveaux achats (remboursement indu). Ne pas retirer colonne, objets ou historique pour simuler un rollback.

## Preuves locales du 19 octobre

`node scripts/recette-xp-migration.mjs <schéma du checkout main sans xpBalance>` refuse un baseline déjà migré et cible exclusivement le conteneur `gamenight-test-pg` lié à `127.0.0.1:55439`. Il crée ses propres bases, conserve les dumps et ne supprime aucune base existante.

Répétition complète réussie : bases `gamenight_xp_rehearsal_1792441725052`, `gamenight_xp_restore_1792441725052` et `gamenight_xp_failure_1792441725052`. Dix lignes synthétiques, deux communautés, bornes 0/49/50/799/800/4049/4050/10 000 000/2 147 483 647. Dump restauré identique ; migration sans changement de progression/équipement/objets ; soldes initialisés exactement. Un rôle runtime local limité à SELECT a refusé l'UPDATE sans changer les données ; cela ne valide pas les privilèges réels de Production. Une écriture de l'ancien code a reproduit une dérive de 30 XP. Le cas négatif a reproduit l'échec Prisma avec rollback SQL et historique bloquant. Checksum du dump : `a541f30b05e72a22852d6a492cff07cebb8de3ff3822924164ee69569c169ab0`.

Avant l'intégration du main le 2026-10-20 : six suites PostgreSQL ciblées en série, **101/101** (dont le test supplémentaire aux seuils de niveaux et grades) ; unitaires sans intégration **2 018/2 018**, aucun ignoré ; TypeScript et ESLint ciblé verts. La revue indépendante de la procédure a fait corriger la barrière des nouveaux writers et l'interdiction des pages GET potentiellement mutatrices. La tête #291 vient d'intégrer `7a06131`; les anciens résultats locaux restent des preuves acquises pour leur code et ne sont pas relancés, mais la CI du nouveau commit doit passer avant toute décision.

Ces fixtures ne valident ni l'état réel ni la durée de sauvegarde/restauration Production. La recette navigateur locale boutique déjà acquise est conservée : achats, équipement/retrait, insuffisance et grade mobile ; aucune raison de la réinstaller ou de la rejouer sans changement de ce parcours.

## Reprise technique du 2026-10-20 (portable 2, aucune écriture Production)

- Cible Neon **candidate**, déjà lue le 20 octobre : projet `misty-tooth-45335023`, branche `br-super-cell-b1ukvk08` (`production`), base `neondb`. Le dépôt ne contient que `DATABASE_URL` comme source Prisma runtime et migration (`prisma/schema.prisma`, `src/lib/prisma.ts`); il ne relie pas l'URL chiffrée de Vercel à cette branche. Aucun `DATABASE_URL`, `NEON_*` ou `VERCEL_*` n'est présent dans l'environnement de ce portable. Le connecteur Vercel répond 403 sur l'équipe `mpmaximeparisot-6230s-projects` même pour `decrypt=false`; le CLI Vercel n'est pas installé. La cible effective reste donc **non prouvée**.
- Inventaire **du code** des writers : requêtes web authentifiées (actions, callbacks Steam/Discord et interaction Discord), onze routes `src/app/api/cron/*` (`close-sessions`, `community-guild-sync`, `discord-thread-cleanup`, `free-game-discord`, `monthly-tasks`, `notification-executor`, `refresh-discord-profiles`, `reminders`, `retention-cleanup`, `steam-library-full-sync`, `steam-library-sync`), dont le déclencheur externe cron-job.org doit être recensé; anciens déploiements Vercel encore appelables et requêtes en vol; éventuels scripts opérateur hors dépôt. GitHub Actions CI migre uniquement son Postgres de service `127.0.0.1:55439`. `scripts/build.mjs` de main exécute `prisma migrate deploy` en Production; celui de cette PR ne le fait plus. Cet inventaire des chemins **ne prouve pas** les jobs actifs ni les identités PostgreSQL utilisées.
- Barrière préparée, **non exécutée** : associer chaque chemin ci-dessus à son URL, rôle et déclencheur; confirmer un rôle de migration séparé. Pour la fenêtre approuvée, rendre inopérants les anciens et nouveaux accès DML au niveau de la base, désactiver les déclencheurs externes, attendre/drainer les appels Vercel en vol, puis vérifier `pg_stat_activity` et un refus DML avec le rôle runtime. Un `REVOKE` seul sur un propriétaire de tables ou une connexion déjà ouverte ne constitue pas une barrière. Garder le build de #291 sans `migrate deploy` automatique et le nouveau runtime sans DML jusqu'au contrôle post-migration. Aucune de ces actions n'est autorisée ou commencée ici.
- Sauvegarde réelle : le connecteur Neon échoue actuellement sur `list_snapshots` avec une erreur de transport vers `https://mcp.neon.tech/mcp` (deux essais); `neon` CLI n'est pas installé. Aucun snapshot Production n'a été listé ni restauré dans cette session. Une fois l'accès rétabli, l'action non destructive prévue est de sélectionner un snapshot de **cette** branche, le restaurer sous **un nouveau nom** `xp291-backup-proof-20261020` sans `target_branch_id`, puis comparer sur cette seule branche la base, les migrations, le nombre de membres et une empreinte des clés/XP/objets. Conserver la branche de preuve; ne jamais restaurer sur `production`. Un clone à HEAD n'est pas une preuve de restauration d'un snapshot. La restauration du dump custom pris sous barrière reste exigée pour la fenêtre de migration.
- Accès précis à rétablir : (1) autoriser le connecteur Vercel pour l'équipe `mpmaximeparisot-6230s-projects` et le projet `gamenight` afin que je puisse lire la **destination** de `DATABASE_URL` Production sans publier sa valeur; (2) rétablir la connexion du connecteur Neon au projet `misty-tooth-45335023` afin que je puisse lister les snapshots puis effectuer la restauration isolée. Aucun secret ni preuve SQL n'est demandé à l'utilisateur. Après ces accès, il restera à approuver explicitement la fenêtre, la barrière et l'unique migration avant toute opération Production.
