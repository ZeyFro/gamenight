# Migrations Prisma — méthode standard

Décision du propriétaire du 17 novembre 2026. Elle remplace le circuit « Neon Test puis Production avec accords séparés ».

## Cycle

1. **PR** : la migration (additive, nouveau dossier, jamais de modification d'une migration existante) est proposée en PR Draft.
2. **CI** : `verify` passe (Postgres jetable, jamais Neon).
3. **Fusion = accord** : la fusion dans `main` vaut accord du propriétaire pour la migration.
4. **Application automatique** : le workflow `.github/workflows/migrate-production.yml` se déclenche sur un push dans `main` touchant `prisma/migrations/**` ou `prisma/schema.prisma` (ou à la main via `workflow_dispatch`). Il écrit l'heure UTC avant migration dans le résumé du job (point de restauration Neon), affiche `prisma migrate status`, applique `prisma migrate deploy`, puis affiche l'état final.

Le build Vercel ne migre jamais (`npm run build` = `prisma generate` + `next build`).

## Configuration (action manuelle du propriétaire)

- Créer l'environnement GitHub `production-migrations`.
- Y ajouter le secret `PRODUCTION_MIGRATION_DATABASE_URL` : URL **directe** Neon Production, sans `-pooler`.
- Le workflow refuse de tourner si le secret est absent ou si l'URL contient `-pooler`. Jamais de secret dans les journaux, le chat ou le dépôt.

## Retour arrière

- Prisma n'annule pas une migration. Restaurer Neon à l'heure UTC notée dans le résumé du job (restauration instantanée de la branche `production`), puis corriger par une nouvelle migration additive.
- Une migration déjà appliquée n'est jamais modifiée : on en crée une nouvelle.

## Ordre des PR en attente

#370 → #406 → #325 seule → #407 / #408 / #416.

#325 est fusionnée seule (ses migrations XP/vocal sont distinctes) ; ensuite seulement #407, #408 et #416. Fusionner une PR à la fois et attendre le workflow vert avant la suivante.

## Garde-fous et risques (relevé du 17 novembre 2026)

### Ce que le workflow garantit
- Seul un push sur `main` ou un lancement manuel **depuis `main`** atteint le secret : le job est gardé par `github.ref == 'refs/heads/main'`.
- Une seule exécution à la fois (`concurrency: migrate-production`, sans annulation) : deux fusions rapprochées sont sérialisées, jamais simultanées.
- L'environnement `production-migrations` impose l'approbation humaine avant la lecture du secret.
- Refus si le secret est absent ou si l'URL contient `-pooler`.

### Fenêtre « nouveau code, ancien schéma » (risque principal)
Vercel déploie `main` dès la fusion ; la migration attend l'approbation. Entre les deux, le nouveau code tourne sur l'ancien schéma (erreurs `P2022`, colonne absente). Pour #370 : `captainId`, `lastTeamLeftAt`, `captainLastActivityAt`.
- Fusionner une PR avec migration **seulement quand l'approbation peut être donnée tout de suite**.
- Le sens inverse (ancien code, nouveau schéma) est sûr tant que la migration est additive (colonnes nullables ou avec défaut). Exception de #370 : l'index unique `(communityId, userId)` sur `CommunityTeamMember` fait échouer l'ancien code qui ajouterait un second rattachement pendant la fenêtre.

### Échec d'une migration
- Postgres exécute le SQL multi-instructions d'une migration dans une transaction : pas de changement partiel.
- Prisma marque quand même la migration « échouée » et refuse la suivante (P3009). Après contrôle manuel : `prisma migrate resolve --rolled-back <nom>`, puis nouvelle migration corrigée. Jamais de modification de la migration existante.
- Arrêt propre : l'étape « Consignes en cas d'échec » écrit la marche à suivre dans le résumé du run.

### Restauration vérifiable
1. Avant la première fusion avec migration : dans Neon, créer une branche à un instant donné depuis `production`, vérifier qu'elle s'ouvre avec les données, puis décider de son sort (propriétaire). Ne jamais supprimer les branches de sauvegarde existantes.
2. Pendant : relever l'heure UTC du résumé « Point de restauration Neon ».
3. Après échec grave : restaurer `production` à cette heure (console Neon), sur décision du propriétaire uniquement.

### Contrôles que seul le propriétaire peut faire
- Rôle de migration (`neondb_owner` ou dédié) : en lecture seule, `SELECT current_user, has_database_privilege(current_user, current_database(), 'CREATE');` puis droit `CREATE` sur le schéma `public`. Ne pas coller le résultat avec une URL.
- Cible : l'hôte de l'URL est celui de la branche `production`, base `neondb`, hôte direct (sans `-pooler`).
- Réglages GitHub : environnement `production-migrations` avec relecteurs requis et **branches de déploiement limitées à `main`** ; protection de `main` avec `verify` et `immutable` obligatoires. Au dernier relevé (#400), `main` n'avait aucune règle de protection : sans elle, rien n'empêche une fusion sans CI verte.
- Avant #370 : `node scripts/check-team-membership-duplicates.mjs` contre Production en lecture seule (doublons d'appartenance, créateurs orphelins).

## Retour arrière d'une migration (cahier §21.4)

Chaque migration créée à partir du 23 novembre 2026 a un fichier **manuel** `prisma/rollbacks/<nom>.sql` (garde : `src/lib/migrations-rollback.test.ts`). Il n'est **jamais** exécuté automatiquement. La CI le valide (`src/lib/migrations-rollback.integration.test.ts`) : sur la base de test, dans une transaction toujours annulée, retour arrière puis migration rejouée, sans erreur et sans changement final du schéma.

Une migration additive gêne rarement : l'ancien code ignore les colonnes en plus. **Préférer revenir au code précédent (Instant Rollback Vercel) en laissant la migration en place.** Le retour arrière SQL ne sert que si la migration elle-même pose problème.

Si Maxime décide de défaire une migration :

| # | Étape | Qui | Preuve |
| --- | --- | --- | --- |
| 1 | Éteindre l'interrupteur concerné, puis remettre en Production un déploiement **antérieur** à la migration (Vercel, Instant Rollback) | Maxime | Déploiement actif daté d'avant la fusion |
| 2 | Noter l'heure UTC (point de restauration Neon, au cas où) | Maxime | Heure notée |
| 3 | Exécuter le contenu de `prisma/rollbacks/<nom>.sql` dans la console SQL Neon, branche `production` | Maxime | Message « succès » de la console |
| 4 | Marquer la migration comme annulée : `npx prisma migrate resolve --rolled-back <nom>` (même accès que le run « Migrations Production ») | Maxime | Sortie de la commande |
| 5 | Vérifier `prisma migrate status` puis une page de l'application | Maxime | Capture |

Les données écrites dans les colonnes supprimées depuis la migration sont **perdues** : c'est pourquoi l'étape 1 (revenir au code sans toucher à la base) suffit presque toujours.

## Procédure de fusion d'une PR avec migration (modèle : #370)

À suivre dans l'ordre. Chaque étape a une preuve.

| # | Étape | Qui | Preuve |
| --- | --- | --- | --- |
| 1 | CI verte sur la tête exacte (`verify`, `rules`, `storage`, `immutable`, Vercel) et branche à jour avec `main` | Claude | Checks GitHub sur le SHA |
| 2 | Le SQL de la migration est identique dans toutes les branches de la pile (même empreinte Git) | Claude | `git rev-parse <branche>:prisma/migrations/<nom>/migration.sql` |
| 3 | Restauration éprouvée (voir ci-dessous) | Propriétaire | Branche de test ouverte et lisible, heure UTC notée |
| 4 | Précontrôle Production en lecture seule : Actions → « Précontrôle Production (lecture seule) » → approuver | Propriétaire | Résumé du run : 0 inachevée, 0 doublon, 0 orphelin ; dernière migration attendue |
| 5 | Garde de build en application stricte : `MIGRATION_GATE_ENFORCE=true` dans Vercel Production, après lecture du rapport (voir « Garde de build ») | Propriétaire | Ligne `[migration-gate] … Schéma à jour` dans le journal d'un build Production |
| 6 | Fusion, puis approbation immédiate du run « Migrations Production » | Propriétaire | Résumé : heure UTC de restauration, `migrate status` avant et après |
| 7 | Vérifier que `migrate status` après indique « Database schema is up to date » et que la nouvelle migration figure parmi les appliquées | Propriétaire | Fin du résumé du run |
| 8 | Seulement alors, vérifier le déploiement Vercel Production et tester une page d'équipe | Propriétaire | Déploiement READY, page sans erreur |

Le précontrôle (`scripts/precheck-team-membership.mjs`) ouvre une transaction `READ ONLY`, ne lit que des compteurs et n'écrit ni l'URL ni aucun identifiant. Il partage le groupe de concurrence `migrate-production` : il ne peut pas tourner pendant une migration.

### Garanties de restauration Neon : ce qui est établi et ce qui ne l'est pas
- **Non vérifié depuis le dépôt** : la durée de conservation de l'historique du projet (elle dépend du plan Neon) et donc l'instant le plus ancien restaurable. Le lire dans la console Neon (réglages du projet, restauration instantanée) **avant** la fusion, et noter qu'elle couvre bien l'heure de la migration.
- **Établi par la documentation Neon** : la restauration instantanée (point dans le temps) est distincte de « Reset from parent », qui remplace une branche enfant par l'état **courant** de son parent et ne permet donc pas de revenir en arrière. Après une restauration depuis un instantané, « Reset from parent » peut être indisponible jusqu'à 24 h.
- **Éprouver** : créer une branche à l'instant voulu depuis `production`, s'y connecter en lecture, compter des lignes d'une table connue, puis noter l'heure et décider du sort de la branche. Ne jamais supprimer `backup-avant-tower-migrations-20261030`.
- **Limite** : une restauration revient aussi sur les données écrites par les joueurs après l'heure notée. Elle est donc un dernier recours ; une migration additive qui échoue est annulée par PostgreSQL sans restauration.

### Fenêtre « nouveau code, ancien schéma » : options étudiées (option A retenue le 17 novembre 2026)
**Décision du propriétaire : option A.** Elle est décrite et implémentée dans la section « Garde de build » ci-dessous ; les options B et C sont conservées pour mémoire.

Vercel déploie `main` dès la fusion, l'approbation peut tarder. Pour ne pas dépendre de la rapidité de l'approbation :

**Option A (retenue) : garde de build en Production.** Dans `scripts/build.mjs`, si `VERCEL_ENV=production`, comparer les dossiers de `prisma/migrations` du commit aux lignes terminées de `_prisma_migrations` (lecture seule, `DATABASE_URL` du build). S'il en manque une : le build échoue, **le déploiement précédent reste servi**. Après l'approbation, redéployer le même commit (bouton Redeploy ou hook). Pas de secret supplémentaire ; le build rouge pendant l'attente est attendu. Coûts : le build dépend de la base (échec fermé si elle est injoignable) et le rôle du build doit pouvoir lire `_prisma_migrations`. Les Preview ne sont pas concernées.

**Option B : étape « Ignored Build Step » + Deploy Hook.** Le script d'ignorance de #423 saute le build Production quand le commit touche `prisma/migrations/**` ou `schema.prisma` ; `migrate-production.yml` appelle ensuite un Deploy Hook Vercel après `migrate deploy` réussi. Ordre garanti par construction (migration, puis déploiement), mais exige un secret de hook (action du propriétaire) et une erreur dans le script d'ignorance bloquerait des déploiements légitimes.

**Option C : code tolérant (expand/contract).** Le nouveau code n'utilise la colonne qu'après détection de son existence. Aucune dépendance d'ordre, mais coûteux et source d'erreurs : non retenu.

L'option A est implémentée, livrée en mode rapport. Tant que `MIGRATION_GATE_ENFORCE=true` n'est pas défini dans Vercel Production, la seule protection reste d'approuver le run immédiatement après la fusion.

## État des piles après #370 (relevé du 17 novembre)
- Le SQL de `20261104140000_tower_team_membership_policy` et celui de `20261105120000_tower_launch_channels_appeals_matchmaking` sont identiques (même empreinte Git) dans les branches de #370, #406, #407, #408 et #416.
- Simulation de `main` + #370 fusionnée : #406, #407, #408 et #416 fusionnent sans conflit.
- #444 entrerait en conflit sur `prisma/schema.prisma`, `src/lib/community-teams.ts` et `.env.example` : c'est à son propriétaire de le résoudre après la fusion de #370.

## Garde de build « anti-fenêtre » (option A, décidée le 17 novembre 2026)

**Objectif** : un déploiement Production dont le code attend une migration non encore appliquée ne doit jamais devenir accessible.

### Fonctionnement
1. `scripts/build.mjs` exécute, entre `prisma generate` et `next build`, `scripts/assert-migrations-applied.mjs`.
2. En **Production** (`VERCEL_ENV=production`), la garde compare les dossiers de `prisma/migrations` du commit aux lignes **terminées** de `_prisma_migrations` (transaction `READ ONLY`, aucune écriture).
3. S'il manque une migration, ou s'il en reste une inachevée, le build **échoue** : Vercel ne crée pas de nouveau déploiement Production et **le précédent reste servi**.
4. Le workflow « Migrations Production » reste soumis à l'approbation de `production-migrations`. Après `migrate deploy` et `migrate status` réussis, il appelle un Deploy Hook Vercel (secret facultatif `VERCEL_DEPLOY_HOOK_URL` de l'environnement) : le nouveau build passe alors la garde. Sans hook : bouton **Redeploy** de Vercel sur le dernier commit de `main`. Un hook en échec n'est pas un échec de migration : avertissement et consigne de redéploiement manuel.
5. Les Preview, le build local et la CI ne sont pas concernés (la garde se désactive hors Production).

### Mise en service progressive (obligatoire)
La garde est livrée en **mode rapport** : sans `MIGRATION_GATE_ENFORCE=true` elle journalise le résultat et ne bloque jamais.
1. Fusionner la PR de la garde (aucune migration, ne déclenche pas le workflow de migration).
2. Lire dans le journal du premier build Production la ligne `[migration-gate]` : elle doit indiquer « Schéma à jour ». Si elle signale une migration en attente ou une base illisible, **ne pas activer** : corriger d'abord (par exemple, une migration déjà fusionnée mais jamais appliquée).
3. Dans Vercel, environnement **Production** seulement, définir `MIGRATION_GATE_ENFORCE=true`. Le flag ne doit pas exister en Preview.
4. Éventuellement créer le Deploy Hook Vercel (branche `main`) et l'ajouter comme secret `VERCEL_DEPLOY_HOOK_URL` de l'environnement `production-migrations`.

### Secrets et périmètre de lecture
- La garde ne lit **rien** hors Production : `VERCEL_ENV !== production` la fait sortir avant tout accès à une variable de connexion. Les builds Preview (branches, PR) n'ouvrent donc aucune connexion, même si une variable de base est présente dans leur environnement.
- **Recommandé : un rôle dédié en lecture seule.** Créer dans Neon un rôle `migration_gate` avec uniquement `CONNECT`, `USAGE` sur le schéma `public` et `SELECT` sur `public."_prisma_migrations"`, puis définir son URL dans la variable `MIGRATION_GATE_DATABASE_URL` de Vercel, **environnement Production seulement**. Sans elle, la garde utilise `DATABASE_URL` (rôle de l'application) : la transaction `READ ONLY` limite alors le risque mais le build tourne avec un rôle d'écriture. Ne jamais copier cette URL dans le dépôt, les journaux ou une PR.
- Requêtes : trois instructions SQL fixes (`SET TRANSACTION READ ONLY`, deux `SELECT` sur `_prisma_migrations`), sans valeur interpolée ; délai de 20 s ; les messages ne contiennent que des noms de migration, des compteurs et un code d'erreur.
- Contributions non fiables : une branche de fork ne reçoit pas les variables Vercel. Pour une branche du dépôt, le build Preview exécute le code de la branche (risque propre à Vercel, inchangé) ; seule la Production (`main`, code relu) exécute la lecture de la garde. Garder « Deployment Protection » et l'autorisation des builds de PR externes activées côté Vercel.

### Comportement strict (flag à `true`)
- Migration manquante ou inachevée : build refusé, noms des migrations manquantes dans le journal.
- Base illisible, `DATABASE_URL` absent, délai de 20 s dépassé : build refusé (échec fermé). Les messages n'affichent jamais l'hôte ni l'URL.
- Secours en cas d'urgence quand la base est injoignable : promouvoir un déploiement précédent depuis Vercel, ou retirer `MIGRATION_GATE_ENFORCE` (décision du propriétaire, tracée dans les réglages Vercel).

### Séquence avec la garde en application stricte (complète les étapes 5 à 8 ci-dessus)
1. CI verte sur le SHA exact ; garde en application stricte.
2. Fusion de la PR : le build Production **échoue volontairement** (ligne `Build refusé`), l'ancien déploiement reste servi.
3. Approuver le run « Migrations Production » ; vérifier l'heure UTC de restauration, `migrate status` avant et après.
4. Le hook (ou Redeploy manuel) relance un build : la ligne `Schéma à jour` apparaît et le déploiement devient accessible.
5. Contrôle de l'ancien code pendant l'attente : la page d'équipe d'avant la fusion fonctionne toujours.

### Limites connues
- Le comportement « le précédent déploiement reste servi après un build échoué » est celui de Vercel ; il n'est pas démontrable depuis le dépôt (voir la section de démonstration dans la PR).
- La garde lit `_prisma_migrations` avec `DATABASE_URL` du build (URL poolée) ; si le pooler refuse la lecture, le mode rapport le révèle avant l'activation.
- Elle ne vérifie que « toutes les migrations du commit sont appliquées », pas la forme du schéma : une migration appliquée manuellement et marquée terminée passe.

## Activation stricte de la garde : preuves à réunir, dans l'ordre

`MIGRATION_GATE_ENFORCE=true` ne se définit qu'après ces quatre preuves.

1. **Le schéma Production est à jour.** Actions → « Précontrôle Production (lecture seule) » → approuver. Le résumé « Garde de build : simulation stricte » doit afficher « N migration(s) dans le commit, N appliquée(s) en base » puis « Schéma à jour ».
2. **La connexion de lecture seule fonctionne.** Ajouter (facultatif mais recommandé) le secret `MIGRATION_GATE_DATABASE_URL` à l'environnement `production-migrations` : URL du rôle `migration_gate` (SELECT seul). Relancer le précontrôle : la ligne « source de connexion » doit indiquer `MIGRATION_GATE_DATABASE_URL (rôle dédié)` et la simulation doit réussir. Sans ce secret, la simulation teste l'URL de migration, qui n'est pas représentative du rôle du build.
3. **Le build Vercel lit bien la base.** Définir la même URL dans `MIGRATION_GATE_DATABASE_URL` de Vercel (Production seulement), puis lire dans le journal du premier build Production en mode rapport : `source de connexion : MIGRATION_GATE_DATABASE_URL (rôle dédié)` et `Schéma à jour`. Ce build prouve le chemin réel de Vercel (pooler, réseau), que la simulation GitHub (connexion directe) ne prouve pas.
4. **Activer** : `MIGRATION_GATE_ENFORCE=true` dans Vercel, environnement Production seulement.

Si l'une des preuves échoue (migration en attente, base illisible, rôle refusé), ne pas activer : corriger d'abord.

## Vérification de restauration Neon (lecture seule, sans toucher à Production)

Objectif : prouver qu'une restauration à un instant donné fonctionne dans ce projet, avant la première migration.

1. Lancer le précontrôle : le résumé « Empreinte de la base » donne l'empreinte **E1** (compteurs et dates, aucune donnée personnelle) et son heure UTC **T1**.
2. Dans Neon, créer une **branche** depuis `production` à l'instant **T0** (par exemple T1 − 15 min). Ne jamais lancer une restauration de la branche `production`, ne jamais supprimer les branches de sauvegarde existantes.
3. Dans la console SQL de cette branche, coller le contenu de `scripts/restore-fingerprint.sql` : empreinte **E0**.
4. Comparer E0 et E1 : `migrations_terminees` et `derniere_migration` identiques ; les autres compteurs ≤ E1 ; les dates « la plus récente » ≤ T0. Un écart est normal s'il s'explique par l'activité entre T0 et T1.
5. Consigner dans l'issue #400 : nom de la branche, T0, T1, E0, E1. Aucune URL.

Ce que cela prouve : la restauration à un instant donné ouvre une base lisible qui contient les données et les migrations attendues. Ce que cela ne prouve pas : la durée maximale de conservation de l'historique (à lire dans les réglages Neon) ni le temps d'une vraie restauration de Production.
