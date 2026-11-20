-- Titres et cadres cosmétiques saisonniers attribués automatiquement à la clôture de saison (cahier 15).
-- Migration additive : une nouvelle table, aucune table existante modifiée. À appliquer après #416.
CREATE TABLE "TowerSeasonAward" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seasonStartAt" TIMESTAMP(3) NOT NULL,
    "seasonName" VARCHAR(80) NOT NULL,
    "place" INTEGER NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TowerSeasonAward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TowerSeasonAward_communityId_userId_seasonStartAt_key" ON "TowerSeasonAward"("communityId", "userId", "seasonStartAt");
CREATE INDEX "TowerSeasonAward_communityId_userId_expiresAt_idx" ON "TowerSeasonAward"("communityId", "userId", "expiresAt");

ALTER TABLE "TowerSeasonAward" ADD CONSTRAINT "TowerSeasonAward_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerSeasonAward" ADD CONSTRAINT "TowerSeasonAward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
