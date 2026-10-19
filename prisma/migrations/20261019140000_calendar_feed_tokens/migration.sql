CREATE TABLE "CalendarFeedToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CalendarFeedToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalendarFeedToken_tokenHash_key" ON "CalendarFeedToken"("tokenHash");
CREATE UNIQUE INDEX "CalendarFeedToken_userId_communityId_key" ON "CalendarFeedToken"("userId", "communityId");
CREATE INDEX "CalendarFeedToken_communityId_idx" ON "CalendarFeedToken"("communityId");

ALTER TABLE "CalendarFeedToken" ADD CONSTRAINT "CalendarFeedToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarFeedToken" ADD CONSTRAINT "CalendarFeedToken_communityId_fkey"
FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
