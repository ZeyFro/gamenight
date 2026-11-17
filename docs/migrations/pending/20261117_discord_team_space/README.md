# DiscordTeamSpace — migration en attente

Table d'association fiable entre une équipe GameNight et ses ressources Discord
gérées (`roleId`, `channelId`, guilde). Aucune table existante n'est modifiée.

- Schéma Prisma : `model DiscordTeamSpace` (`prisma/schema.prisma`).
- SQL : `migration.sql` (ce dossier).
- **Non appliquée** sur Neon Production. Sur une base de test jetable :
  `psql "$TEST_DATABASE_URL" -f docs/migrations/pending/20261117_discord_team_space/migration.sql`.

Sans cette table, `discord-team-space-service` renvoie `migration_required` :
aucun stockage de secours en mémoire n'est utilisé en production.

## Recette locale (17/11)

Aucun PostgreSQL local n'est disponible sur ce poste (`TEST_DATABASE_URL`
absent, `psql` introuvable) : la migration **n'a pas été exécutée**. Les parcours
sont couverts par des tests à faux client Prisma et API Discord simulée
(`discord-team-flows.test.ts`) ; la recette SQL reste à faire sur une base
jetable avant toute activation.
