CREATE TABLE "CommunityGameEpitaph" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "epitaph" VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityGameEpitaph_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunityGameEpitaph_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommunityGameEpitaph_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommunityGameEpitaph_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CommunityGameEpitaph_communityId_gameId_key" ON "CommunityGameEpitaph"("communityId", "gameId");
CREATE INDEX "CommunityGameEpitaph_communityId_createdAt_idx" ON "CommunityGameEpitaph"("communityId", "createdAt");
