ALTER TABLE "Community"
ADD COLUMN "playerClassifiedsEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PlayerClassified" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "message" VARCHAR(240) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerClassified_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlayerClassified_communityId_expiresAt_idx"
ON "PlayerClassified"("communityId", "expiresAt");

CREATE INDEX "PlayerClassified_createdById_communityId_idx"
ON "PlayerClassified"("createdById", "communityId");

ALTER TABLE "PlayerClassified"
ADD CONSTRAINT "PlayerClassified_communityId_fkey"
FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerClassified"
ADD CONSTRAINT "PlayerClassified_gameId_fkey"
FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerClassified"
ADD CONSTRAINT "PlayerClassified_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
