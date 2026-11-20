-- Projets à organisateur (entrées validées, date de fin, fils Discord, archivage 7 jours après clôture).
-- Additive : deux enums et deux nouvelles tables, aucune table existante modifiée, aucune suppression.
-- Après #416. Appliquée après fusion par migrate-production.yml (docs/MIGRATIONS.md), jamais au build.

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProjectEntryStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "gameName" VARCHAR(80),
    "maxEntries" INTEGER,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "guildId" TEXT,
    "parentChannelId" TEXT,
    "publicThreadId" TEXT,
    "privateThreadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" VARCHAR(300),
    "status" "ProjectEntryStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "ProjectEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_publicThreadId_key" ON "Project"("publicThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_privateThreadId_key" ON "Project"("privateThreadId");

-- CreateIndex
CREATE INDEX "Project_communityId_status_endsAt_idx" ON "Project"("communityId", "status", "endsAt");

-- CreateIndex
CREATE INDEX "Project_organizerId_idx" ON "Project"("organizerId");

-- CreateIndex
CREATE INDEX "ProjectEntry_projectId_status_idx" ON "ProjectEntry"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectEntry_userId_idx" ON "ProjectEntry"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEntry_projectId_userId_key" ON "ProjectEntry"("projectId", "userId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEntry" ADD CONSTRAINT "ProjectEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEntry" ADD CONSTRAINT "ProjectEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEntry" ADD CONSTRAINT "ProjectEntry_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
