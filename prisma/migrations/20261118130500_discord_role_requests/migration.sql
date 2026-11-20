-- Demandes de création de rôle de jeu Discord (/role, DISCORD_ROLE_AUTOCREATE_ENABLED) : une nouvelle table, aucune table existante modifiée.
-- Additive. Appliquée automatiquement après fusion dans main par `migrate-production.yml` (docs/MIGRATIONS.md), jamais au build.
-- Sans la table, la création automatique reste fermée : /role retombe sur son comportement actuel, aucune écriture Discord.
CREATE TYPE "DiscordRoleRequestStatus" AS ENUM ('PENDING', 'CREATED', 'FAILED');

CREATE TABLE "DiscordRoleRequest" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "requesterDiscordId" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "DiscordRoleRequestStatus" NOT NULL DEFAULT 'PENDING',
    "roleId" TEXT,
    "failureReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordRoleRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiscordRoleRequest_guildId_nameKey_key" ON "DiscordRoleRequest"("guildId", "nameKey");
CREATE INDEX "DiscordRoleRequest_requesterDiscordId_requestedAt_idx" ON "DiscordRoleRequest"("requesterDiscordId", "requestedAt");
CREATE INDEX "DiscordRoleRequest_communityId_status_idx" ON "DiscordRoleRequest"("communityId", "status");

ALTER TABLE "DiscordRoleRequest" ADD CONSTRAINT "DiscordRoleRequest_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
