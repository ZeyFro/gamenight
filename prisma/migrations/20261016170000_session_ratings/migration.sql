CREATE TABLE "SessionRating" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "communityId" TEXT,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SessionRating_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SessionRating_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX "SessionRating_sessionId_userId_key" ON "SessionRating"("sessionId", "userId");
CREATE INDEX "SessionRating_communityId_sessionId_idx" ON "SessionRating"("communityId", "sessionId");

ALTER TABLE "SessionRating" ADD CONSTRAINT "SessionRating_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionRating" ADD CONSTRAINT "SessionRating_communityId_fkey"
    FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SessionRating" ADD CONSTRAINT "SessionRating_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
