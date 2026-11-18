-- Migration isolée : association fiable équipe ↔ espace Discord.
--
-- Additive et idempotente : uniquement une nouvelle table et ses index
-- (`IF NOT EXISTS`). Aucune table existante n'est modifiée, aucune donnée n'est
-- lue, déplacée ou supprimée, aucune clé étrangère n'est posée (le schéma Prisma
-- ne déclare pas de relation : le nettoyage est applicatif).
--
-- Appliquée automatiquement à Neon Production par `migrate-production.yml`
-- quand la PR #444 est fusionnée (méthode standard, docs/MIGRATIONS.md). Sur une
-- base sans la table, le service reste fermé (`migration_required`).

CREATE TABLE IF NOT EXISTS "DiscordTeamSpace" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "DiscordTeamSpace_teamId_key" ON "DiscordTeamSpace"("teamId");
CREATE UNIQUE INDEX IF NOT EXISTS "DiscordTeamSpace_channelId_key" ON "DiscordTeamSpace"("channelId");
CREATE INDEX IF NOT EXISTS "DiscordTeamSpace_communityId_idx" ON "DiscordTeamSpace"("communityId");
