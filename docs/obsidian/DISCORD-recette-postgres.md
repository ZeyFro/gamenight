# Recette PostgreSQL isolée (17/11)

Conteneur dédié `gamenight-test-pg-20261117` (postgres:16-alpine, port 55440),
aucun volume ni conteneur existant touché. Base `gamenight_test_20261117`.

1. `prisma migrate deploy` (119 migrations de l'historique) : OK.
2. `docs/migrations/pending/20261117_discord_team_space/migration.sql` : OK.
3. `docs/migrations/pending/20261117_team_captain/migration.sql` : OK.
4. `TEST_DATABASE_URL=… npx vitest run src/lib/discord-team-space.integration.test.ts` :
   **6 tests verts**.

Couverts : unicité `teamId`/`channelId` (P2002), rejeu et concurrence (une seule
ligne), persistance après nouveau client Prisma, parcours création → adhésion →
départ (rôle retiré, compteur `XpEvent` inchangé), archivage limité au salon
associé, passation `captainId` avec `createdById` intact.

Limites : pas de service Discord réel ; aucune migration appliquée à Neon ni en
Production. Le conteneur peut être supprimé avec
`docker rm -f gamenight-test-pg-20261117`.
