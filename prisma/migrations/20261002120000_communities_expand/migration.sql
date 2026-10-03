-- Multi-communautés, PR A (expand uniquement) : nouvelles tables et nouveaux
-- types, aucun objet existant modifié. Généré par `prisma migrate diff`, dont
-- on a retiré deux écarts préexistants sans rapport (UserNotificationPreference
-- .updatedAt, renommage d’index NotificationDelivery) — à traiter à part.

-- CreateEnum
CREATE TYPE "CommunityStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'LEFT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CommunityRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'LEFT', 'REMOVED');

-- CreateEnum
CREATE TYPE "CommunityChannelCategory" AS ENUM ('SESSION', 'TOURNAMENT');

-- CreateTable
CREATE TABLE "Community" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discordGuildId" TEXT,
    "iconHash" TEXT,
    "status" "CommunityStatus" NOT NULL DEFAULT 'PENDING',
    "installedByDiscordId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "activatedById" TEXT,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityChannelConfig" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "category" "CommunityChannelCategory" NOT NULL,
    "discordChannelId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityChannelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CommunityRole" NOT NULL DEFAULT 'MEMBER',
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Community_slug_key" ON "Community"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Community_discordGuildId_key" ON "Community"("discordGuildId");

-- CreateIndex
CREATE INDEX "Community_status_idx" ON "Community"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityChannelConfig_communityId_category_key" ON "CommunityChannelConfig"("communityId", "category");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_communityId_userId_key" ON "Membership"("communityId", "userId");

-- AddForeignKey
ALTER TABLE "CommunityChannelConfig" ADD CONSTRAINT "CommunityChannelConfig_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
