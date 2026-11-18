# Migrations en attente — état consolidé (17/11)

Ordre d'application après fusion, sur une base de test uniquement :

1. `20261104140000_tower_team_membership_policy` (#370/#408/#416) :
   `captainId`, backfill depuis `createdById`, FK `User`, `captainLastActivityAt`,
   `Membership.lastTeamLeftAt`.
2. `20261106150000_tower_launch_channels_appeals_matchmaking` (#408/#416).
3. `20261201120000_discord_team_space` : **intégrée** dans
   `prisma/migrations/20261201120000_discord_team_space/` (elle n'est plus en
   attente ici). Elle doit rester appliquée après les migrations ci-dessus.

Aucune migration capitaine séparée : `20261117_team_captain` est **annulée**
(colonne déjà fournie par l'étape 1). Voir son README.

Tant que l'étape 1 n'est pas fusionnée, `prisma/schema.prisma` ne déclare pas
`CommunityTeam.captainId` : le schéma de cette branche reste identique à ses
migrations (CI verte), et `community-team-captain-store.ts` lit la colonne par
nom, en repli explicite sur `createdById` (`supported: false`,
`captain_source_unavailable`).

Aucune de ces migrations n'est appliquée à Neon Test ou Production.
