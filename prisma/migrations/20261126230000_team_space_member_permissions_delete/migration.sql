-- D5 : permissions par membre (plus de rôle obligatoire) et journal de suppression.
ALTER TABLE "DiscordTeamSpace" ALTER COLUMN "roleId" DROP NOT NULL;
ALTER TABLE "DiscordTeamSpace" ADD COLUMN "deletedAt" TIMESTAMP(3);
