-- Centre de notifications (sujet I). Migration additive : une seule nouvelle table, aucune table
-- existante modifiée. Opt-in explicite aux pings d'un jeu, par membre et par communauté.
CREATE TABLE "GamePingOptIn" (
    "userId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GamePingOptIn_pkey" PRIMARY KEY ("userId","communityId","gameId")
);

CREATE INDEX "GamePingOptIn_communityId_gameId_idx" ON "GamePingOptIn"("communityId", "gameId");

ALTER TABLE "GamePingOptIn" ADD CONSTRAINT "GamePingOptIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GamePingOptIn" ADD CONSTRAINT "GamePingOptIn_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GamePingOptIn" ADD CONSTRAINT "GamePingOptIn_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
