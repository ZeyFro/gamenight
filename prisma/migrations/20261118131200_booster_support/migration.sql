-- Soutien Nitro (DISCORD_BOOSTERS_ENABLED) : deux nouvelles tables, aucune table existante modifiée.
-- Additive. Appliquée automatiquement après fusion dans main par `migrate-production.yml` (docs/MIGRATIONS.md), jamais au build.
-- Sans elles, le cron et les écritures Discord restent fermés (aucune écriture).
CREATE TABLE "BoosterSupport" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "boosting" BOOLEAN NOT NULL DEFAULT false,
    "since" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "roleGranted" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoosterSupport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BoosterSupportSpace" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "voiceChannelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoosterSupportSpace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BoosterSupport_communityId_userId_key" ON "BoosterSupport"("communityId", "userId");
CREATE INDEX "BoosterSupport_communityId_boosting_since_idx" ON "BoosterSupport"("communityId", "boosting", "since");
CREATE INDEX "BoosterSupport_communityId_checkedAt_idx" ON "BoosterSupport"("communityId", "checkedAt");
CREATE UNIQUE INDEX "BoosterSupportSpace_communityId_key" ON "BoosterSupportSpace"("communityId");
CREATE UNIQUE INDEX "BoosterSupportSpace_channelId_key" ON "BoosterSupportSpace"("channelId");
CREATE UNIQUE INDEX "BoosterSupportSpace_voiceChannelId_key" ON "BoosterSupportSpace"("voiceChannelId");

ALTER TABLE "BoosterSupport" ADD CONSTRAINT "BoosterSupport_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoosterSupport" ADD CONSTRAINT "BoosterSupport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoosterSupportSpace" ADD CONSTRAINT "BoosterSupportSpace_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
