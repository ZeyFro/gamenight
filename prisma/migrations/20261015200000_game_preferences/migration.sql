ALTER TABLE "User"
  ADD COLUMN "preferredGameCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "refusedGameCategories" TEXT[] DEFAULT ARRAY[]::TEXT[];
CREATE TABLE "UserGameRefusal" (
  "userId" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserGameRefusal_pkey" PRIMARY KEY ("userId", "gameId")
);
CREATE INDEX "UserGameRefusal_gameId_idx" ON "UserGameRefusal"("gameId");
ALTER TABLE "UserGameRefusal" ADD CONSTRAINT "UserGameRefusal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserGameRefusal" ADD CONSTRAINT "UserGameRefusal_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
