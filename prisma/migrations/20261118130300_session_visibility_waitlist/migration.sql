-- Visibilité des soirées (publique / sur candidature / privée), coorganisateur, candidatures et espace Discord
-- temporaire (fil privé + vocal). Additive : deux enums, deux tables, deux colonnes ajoutées à "Session" avec
-- valeur par défaut (les soirées existantes restent PRIVATE = comportement actuel). Aucune suppression.
-- Après #416. Appliquée après fusion par migrate-production.yml (docs/MIGRATIONS.md), jamais au build.

-- CreateEnum
CREATE TYPE "SessionVisibility" AS ENUM ('PRIVATE', 'PUBLIC', 'APPLICATION');

-- CreateEnum
CREATE TYPE "SessionApplicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "coOrganizerId" TEXT,
ADD COLUMN     "visibility" "SessionVisibility" NOT NULL DEFAULT 'PRIVATE';

-- CreateTable
CREATE TABLE "SessionApplication" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "message" VARCHAR(300),
    "status" "SessionApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "SessionApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionDiscordSpace" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "parentChannelId" TEXT NOT NULL,
    "threadId" TEXT,
    "voiceChannelId" TEXT,
    "cleanedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionDiscordSpace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionApplication_sessionId_status_idx" ON "SessionApplication"("sessionId", "status");

-- CreateIndex
CREATE INDEX "SessionApplication_applicantId_idx" ON "SessionApplication"("applicantId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionApplication_sessionId_applicantId_key" ON "SessionApplication"("sessionId", "applicantId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionDiscordSpace_sessionId_key" ON "SessionDiscordSpace"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionDiscordSpace_threadId_key" ON "SessionDiscordSpace"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionDiscordSpace_voiceChannelId_key" ON "SessionDiscordSpace"("voiceChannelId");

-- CreateIndex
CREATE INDEX "SessionDiscordSpace_communityId_idx" ON "SessionDiscordSpace"("communityId");

-- CreateIndex
CREATE INDEX "SessionDiscordSpace_cleanedAt_idx" ON "SessionDiscordSpace"("cleanedAt");

-- CreateIndex
CREATE INDEX "Session_coOrganizerId_idx" ON "Session"("coOrganizerId");

-- CreateIndex
CREATE INDEX "Session_visibility_status_date_idx" ON "Session"("visibility", "status", "date");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_coOrganizerId_fkey" FOREIGN KEY ("coOrganizerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionApplication" ADD CONSTRAINT "SessionApplication_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionApplication" ADD CONSTRAINT "SessionApplication_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionApplication" ADD CONSTRAINT "SessionApplication_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionDiscordSpace" ADD CONSTRAINT "SessionDiscordSpace_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionDiscordSpace" ADD CONSTRAINT "SessionDiscordSpace_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
