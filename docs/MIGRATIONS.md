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

### Comportement strict (flag à `true`)
- Migration manquante ou inachevée : build refusé, noms des migrations manquantes dans le journal.
- Base illisible, `DATABASE_URL` absent, délai de 20 s dépassé : build refusé (échec fermé). Les messages n'affichent jamais l'hôte ni l'URL.
- Secours en cas d'urgence quand la base est injoignable : promouvoir un déploiement précédent depuis Vercel, ou retirer `MIGRATION_GATE_ENFORCE` (décision du propriétaire, tracée dans les réglages Vercel).

### Séquence vérifiable pour fusionner une PR avec migration (modèle #370)
1. CI verte sur le SHA exact ; garde en application stricte.
2. Fusion de la PR : le build Production **échoue volontairement** (ligne `Build refusé`), l'ancien déploiement reste servi.
3. Approuver le run « Migrations Production » ; vérifier l'heure UTC de restauration, `migrate status` avant et après.
4. Le hook (ou Redeploy manuel) relance un build : la ligne `Schéma à jour` apparaît et le déploiement devient accessible.
5. Contrôle de l'ancien code pendant l'attente : la page d'équipe d'avant la fusion fonctionne toujours.

### Limites connues
- Le comportement « le précédent déploiement reste servi après un build échoué » est celui de Vercel ; il n'est pas démontrable depuis le dépôt (voir la section de démonstration dans la PR).
- La garde lit `_prisma_migrations` avec `DATABASE_URL` du build (URL poolée) ; si le pooler refuse la lecture, le mode rapport le révèle avant l'activation.
- Elle ne vérifie que « toutes les migrations du commit sont appliquées », pas la forme du schéma : une migration appliquée manuellement et marquée terminée passe.
