-- Sprint 3 : card "Actu gaming" — cache des news Steam par jeu.
CREATE TABLE "GameNews" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "steamAppId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "feedLabel" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameNews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameNews_steamAppId_title_key" ON "GameNews"("steamAppId", "title");

CREATE INDEX "GameNews_publishedAt_idx" ON "GameNews"("publishedAt");

ALTER TABLE "GameNews" ADD CONSTRAINT "GameNews_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
