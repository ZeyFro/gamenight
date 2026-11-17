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

## Correction après inspection des PR (17/11)

`captainId` **existe déjà** dans `20261104140000_tower_team_membership_policy`
(#370/#408/#416), avec backfill `captainId = createdById` et FK `User`. Notre
branche s'arrête à `20261029061000_tower_team_challenges`, d'où l'application
manuelle pour la recette. Après fusion d'une de ces PR, ne **jamais** rejouer de
migration capitaine : `docs/migrations/pending/20261117_team_captain/` est
annulée. Seule la migration `20261117120000_discord_team_space` reste en attente.
