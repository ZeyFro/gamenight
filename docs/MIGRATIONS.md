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

## Procédure de fusion d'une PR avec migration (modèle : #370)

À suivre dans l'ordre. Chaque étape a une preuve.

| # | Étape | Qui | Preuve |
| --- | --- | --- | --- |
| 1 | CI verte sur la tête exacte (`verify`, `rules`, `storage`, `immutable`, Vercel) et branche à jour avec `main` | Claude | Checks GitHub sur le SHA |
| 2 | Le SQL de la migration est identique dans toutes les branches de la pile (même empreinte Git) | Claude | `git rev-parse <branche>:prisma/migrations/<nom>/migration.sql` |
| 3 | Restauration éprouvée (voir ci-dessous) | Propriétaire | Branche de test ouverte et lisible, heure UTC notée |
| 4 | Précontrôle Production en lecture seule : Actions → « Précontrôle Production (lecture seule) » → approuver | Propriétaire | Résumé du run : 0 inachevée, 0 doublon, 0 orphelin ; dernière migration attendue |
| 5 | Mécanisme anti-fenêtre choisi et en place (voir ci-dessous) | Propriétaire | Décision écrite dans l'issue #400 |
| 6 | Fusion, puis approbation immédiate du run « Migrations Production » | Propriétaire | Résumé : heure UTC de restauration, `migrate status` avant et après |
| 7 | Vérifier que `migrate status` après indique « Database schema is up to date » et que la nouvelle migration figure parmi les appliquées | Propriétaire | Fin du résumé du run |
| 8 | Seulement alors, vérifier le déploiement Vercel Production et tester une page d'équipe | Propriétaire | Déploiement READY, page sans erreur |

Le précontrôle (`scripts/precheck-team-membership.mjs`) ouvre une transaction `READ ONLY`, ne lit que des compteurs et n'écrit ni l'URL ni aucun identifiant. Il partage le groupe de concurrence `migrate-production` : il ne peut pas tourner pendant une migration.

### Garanties de restauration Neon : ce qui est établi et ce qui ne l'est pas
- **Non vérifié depuis le dépôt** : la durée de conservation de l'historique du projet (elle dépend du plan Neon) et donc l'instant le plus ancien restaurable. Le lire dans la console Neon (réglages du projet, restauration instantanée) **avant** la fusion, et noter qu'elle couvre bien l'heure de la migration.
- **Établi par la documentation Neon** : la restauration instantanée (point dans le temps) est distincte de « Reset from parent », qui remplace une branche enfant par l'état **courant** de son parent et ne permet donc pas de revenir en arrière. Après une restauration depuis un instantané, « Reset from parent » peut être indisponible jusqu'à 24 h.
- **Éprouver** : créer une branche à l'instant voulu depuis `production`, s'y connecter en lecture, compter des lignes d'une table connue, puis noter l'heure et décider du sort de la branche. Ne jamais supprimer `backup-avant-tower-migrations-20261030`.
- **Limite** : une restauration revient aussi sur les données écrites par les joueurs après l'heure notée. Elle est donc un dernier recours ; une migration additive qui échoue est annulée par PostgreSQL sans restauration.

### Fenêtre « nouveau code, ancien schéma » : options proposées
Vercel déploie `main` dès la fusion, l'approbation peut tarder. Pour ne pas dépendre de la rapidité de l'approbation :

**Option A (recommandée) : garde de build en Production.** Dans `scripts/build.mjs`, si `VERCEL_ENV=production`, comparer les dossiers de `prisma/migrations` du commit aux lignes terminées de `_prisma_migrations` (lecture seule, `DATABASE_URL` du build). S'il en manque une : le build échoue, **le déploiement précédent reste servi**. Après l'approbation, redéployer le même commit (bouton Redeploy ou hook). Pas de secret supplémentaire ; le build rouge pendant l'attente est attendu. Coûts : le build dépend de la base (échec fermé si elle est injoignable) et le rôle du build doit pouvoir lire `_prisma_migrations`. Les Preview ne sont pas concernées.

**Option B : étape « Ignored Build Step » + Deploy Hook.** Le script d'ignorance de #423 saute le build Production quand le commit touche `prisma/migrations/**` ou `schema.prisma` ; `migrate-production.yml` appelle ensuite un Deploy Hook Vercel après `migrate deploy` réussi. Ordre garanti par construction (migration, puis déploiement), mais exige un secret de hook (action du propriétaire) et une erreur dans le script d'ignorance bloquerait des déploiements légitimes.

**Option C : code tolérant (expand/contract).** Le nouveau code n'utilise la colonne qu'après détection de son existence. Aucune dépendance d'ordre, mais coûteux et source d'erreurs : non retenu.

Aucune de ces options n'est implémentée : décision du propriétaire requise. Tant qu'aucune n'est en place, la seule protection est d'approuver le run immédiatement après la fusion.

## État des piles après #370 (relevé du 17 novembre)
- Le SQL de `20261104140000_tower_team_membership_policy` et celui de `20261105120000_tower_launch_channels_appeals_matchmaking` sont identiques (même empreinte Git) dans les branches de #370, #406, #407, #408 et #416.
- Simulation de `main` + #370 fusionnée : #406, #407, #408 et #416 fusionnent sans conflit.
- #444 entrerait en conflit sur `prisma/schema.prisma`, `src/lib/community-teams.ts` et `.env.example` : c'est à son propriétaire de le résoudre après la fusion de #370.
