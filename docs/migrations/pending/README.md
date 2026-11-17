# Migrations en attente — état consolidé (17/11)

Ordre d'application après fusion, sur une base de test uniquement :

1. `20261104140000_tower_team_membership_policy` (#370/#408/#416) :
   `captainId`, backfill depuis `createdById`, FK `User`, `captainLastActivityAt`,
   `Membership.lastTeamLeftAt`.
2. `20261106150000_tower_launch_channels_appeals_matchmaking` (#408/#416).
3. `20261117120000_discord_team_space` (ce dossier) : table `DiscordTeamSpace`
   et ses index uniques. Doit être copiée sous
   `prisma/migrations/20261117120000_discord_team_space/migration.sql` au moment
   de l'intégration, donc après les migrations ci-dessus.

Aucune migration capitaine séparée : `20261117_team_captain` est **annulée**
(colonne déjà fournie par l'étape 1). Voir son README.

Aucune de ces migrations n'est appliquée à Neon Test ou Production.
