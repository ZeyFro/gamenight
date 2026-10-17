CREATE TYPE "FreeGameStore" AS ENUM ('STEAM', 'EPIC');

ALTER TABLE "Community"
ADD COLUMN "freeGamesEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "FreeGameOffer" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "store" "FreeGameStore" NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "storeUrl" VARCHAR(500) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FreeGameOffer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FreeGameOffer_communityId_startsAt_endsAt_idx"
ON "FreeGameOffer"("communityId", "startsAt", "endsAt");

CREATE INDEX "FreeGameOffer_createdById_communityId_idx"
ON "FreeGameOffer"("createdById", "communityId");

ALTER TABLE "FreeGameOffer"
ADD CONSTRAINT "FreeGameOffer_communityId_fkey"
FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FreeGameOffer"
ADD CONSTRAINT "FreeGameOffer_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
