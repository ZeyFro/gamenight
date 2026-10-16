CREATE TABLE "GameStyleProfile" (
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tryharder" INTEGER NOT NULL DEFAULT 0,
    "ambianceur" INTEGER NOT NULL DEFAULT 0,
    "stratege" INTEGER NOT NULL DEFAULT 0,
    "chaos" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "GameStyleProfile_pkey" PRIMARY KEY ("communityId", "userId")
);

ALTER TABLE "GameStyleProfile" ADD CONSTRAINT "GameStyleProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
