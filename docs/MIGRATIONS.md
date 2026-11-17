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
