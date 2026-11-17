-- Migration isolée : association fiable équipe ↔ espace Discord.
-- À appliquer UNIQUEMENT sur une base de test jetable, jamais sur Neon
-- Production sans autorisation explicite.

CREATE TABLE "DiscordTeamSpace" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordTeamSpace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiscordTeamSpace_teamId_key" ON "DiscordTeamSpace"("teamId");
CREATE UNIQUE INDEX "DiscordTeamSpace_channelId_key" ON "DiscordTeamSpace"("channelId");
CREATE INDEX "DiscordTeamSpace_communityId_idx" ON "DiscordTeamSpace"("communityId");
