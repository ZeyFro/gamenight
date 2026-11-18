-- Association équipe ↔ espace Discord (salon privé + rôle) : une nouvelle table, aucune table existante modifiée.
-- Additive. À appliquer après #370 (CommunityTeam et son unique (id, communityId)) et #416.
-- Appliquée automatiquement après fusion dans main par `migrate-production.yml` (docs/MIGRATIONS.md), jamais au build.
-- Sans la table, le service reste fermé (`migration_required`) : aucune écriture Discord n'est tentée.
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

ALTER TABLE "DiscordTeamSpace" ADD CONSTRAINT "DiscordTeamSpace_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscordTeamSpace" ADD CONSTRAINT "DiscordTeamSpace_teamId_communityId_fkey" FOREIGN KEY ("teamId", "communityId") REFERENCES "CommunityTeam"("id", "communityId") ON DELETE CASCADE ON UPDATE CASCADE;
