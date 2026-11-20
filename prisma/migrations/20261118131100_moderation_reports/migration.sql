-- Signalements de messages Discord (commande contextuelle « Signaler », DISCORD_REPORT_COMMAND_ENABLED) : une nouvelle table, aucune table existante modifiée.
-- Additive. Appliquée automatiquement après fusion dans main par `migrate-production.yml` (docs/MIGRATIONS.md), jamais au build.
-- Aucune sanction n'est liée à cette table. Sans elle, la commande répond « indisponible » et n'écrit rien.
CREATE TABLE "ModerationReport" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "authorDiscordId" TEXT NOT NULL,
    "reporterDiscordId" TEXT NOT NULL,
    "messageUrl" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "ticketQueuedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModerationReport_guildId_messageId_reporterDiscordId_key" ON "ModerationReport"("guildId", "messageId", "reporterDiscordId");
CREATE INDEX "ModerationReport_communityId_closedAt_createdAt_idx" ON "ModerationReport"("communityId", "closedAt", "createdAt");
CREATE INDEX "ModerationReport_reporterDiscordId_createdAt_idx" ON "ModerationReport"("reporterDiscordId", "createdAt");

ALTER TABLE "ModerationReport" ADD CONSTRAINT "ModerationReport_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
