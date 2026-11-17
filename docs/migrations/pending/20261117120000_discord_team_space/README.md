# `DiscordTeamSpace` — migration en attente

Table d'association fiable équipe ↔ salon/role Discord. Aucune autre PR ouverte
ne la crée (vérifié sur #370, #408, #416).

- Nom d'intégration : `prisma/migrations/20261117120000_discord_team_space/`,
  soit après `20261106150000_tower_launch_channels_appeals_matchmaking`.
- Aucune clé étrangère : le schéma Prisma ne déclare pas de relation (nettoyage
  applicatif), donc pas de contrainte à ajouter.
- Recette réelle : 6 tests PostgreSQL verts (unicité, rejeu, concurrence,
  persistance, archivage ciblé, capitainerie).
- **Non appliquée** sur Neon/Production.
