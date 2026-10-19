# Décision de publication de #291 — aucune opération Production exécutée

PR : https://github.com/ZeyFro/gamenight/pull/291. Elle reste en brouillon. La branche a intégré `origin/main` `1c939ac` sans réécrire son historique. Cette note prépare une autorisation ; elle ne l'accorde pas.

## Opération soumise à autorisation

Autoriser une fenêtre de maintenance avec arrêt vérifié de **tous** les writers, une sauvegarde Production effectivement restaurable, l'application séparée de **l'unique migration en attente `20261019190000_separate_xp_balance`**, puis le déploiement du code #291. Le build actuel exécute `prisma migrate deploy` avant Next ; fusionner cette PR sans préparation déclencherait donc une écriture de schéma et de données en Production. Pour la bascule contrôlée ci-dessous, le build Vercel doit être remplacé par `npx prisma generate && npx next build` ; la migration est exécutée séparément avec un rôle distinct du runtime.

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

## Séquence de bascule à faire autoriser

1. Enregistrer le commit et le déploiement courants, la cible de base exacte et le rôle utilisé par chaque writer : web, actions, callbacks Discord, crons et jobs déjà lancés. Vérifier les privilèges d'un compte de migration distinct. Ne changer aucune protection Vercel.
2. Établir une barrière d'écriture vérifiée pour **anciens et nouveaux runtimes**, y compris URL directes, callbacks, crons et tâches déjà lancées. Une option est une bascule de rôle : désactiver l'ancien accès et terminer ses connexions ; donner au nouveau runtime uniquement des droits de lecture jusqu'à l'étape 6. Le rôle de migration est distinct et n'est jamais injecté au runtime. Cela peut rendre les pages indisponibles pendant la fenêtre. Les commandes de rôles ne peuvent être fixées avant identification de leurs propriétaires, privilèges et poolers. Une simple pause de l'interface ou des crons est insuffisante.
3. Une fois les anciens writers arrêtés et les requêtes en cours drainées, prendre un dump complet au format custom et enregistrer son checksum, son horodatage et le point de restauration fournisseur disponible. Conserver la sauvegarde hors dépôt et ne supprimer aucune branche Neon. Restaurer cette sauvegarde dans une cible isolée avant de la considérer utilisable. `pg_dump` fournit un snapshot cohérent mais n'empêche pas de nouvelles écritures : la barrière de l'étape 2 reste indispensable ([PostgreSQL 16](https://www.postgresql.org/docs/16/app-pgdump.html)).
4. Sur le checkout approuvé, appliquer `npx prisma migrate deploy` avec le rôle de migration et la cible Production vérifiée, puis déployer avec le build `npx prisma generate && npx next build` et le rôle runtime toujours sans DML. Ne pas exécuter de seed, de backfill ni de migration supplémentaire. Garder l'ancien accès désactivé ; même après promotion, le nouveau runtime ne peut pas écrire avant l'étape 6.
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

Après intégration du main courant : six suites PostgreSQL ciblées en série, **101/101** (dont le test supplémentaire aux seuils de niveaux et grades) ; unitaires sans intégration **2 018/2 018**, aucun ignoré ; TypeScript et ESLint ciblé verts. La revue indépendante de la procédure a fait corriger la barrière des nouveaux writers et l'interdiction des pages GET potentiellement mutatrices. Le contrôle CI de la dernière SHA publiée fait foi avant toute décision de fusion.

Ces fixtures ne valident ni l'état réel ni la durée de sauvegarde/restauration Production. La recette navigateur locale boutique déjà acquise est conservée : achats, équipement/retrait, insuffisance et grade mobile ; aucune raison de la réinstaller ou de la rejouer sans changement de ce parcours.
