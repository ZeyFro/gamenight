# `DiscordTeamSpace` — espace Discord d'équipe

Table d'association fiable équipe ↔ salon/rôle Discord. Aucune autre PR ouverte
ne la crée (vérifié sur #370, #408, #416).

- Position : après les migrations de #370 (`20261104140000_…`) et de #408
  (`20261106150000_…`), donc dernière de la pile d'intégration.
- Aucune clé étrangère : le schéma Prisma ne déclare pas de relation (nettoyage
  applicatif), donc pas de contrainte à ajouter.
- Recette réelle : tests PostgreSQL isolés verts (unicité, rejeu, concurrence,
  persistance, archivage ciblé) dans `src/lib/discord-team-space.integration.test.ts`,
  joués en CI sur le PostgreSQL jetable du workflow `tower-challenges.yml`.
- **Non appliquée** sur Neon Test ni Neon Production : la CI ne migre qu'un
  conteneur jetable. Sur une base sans la table, le service reste fermé
  (`migration_required`).
