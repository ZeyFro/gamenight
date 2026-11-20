-- Niveaux de jeu auto-déclarés par jeu (cahier §12.4). Migration additive : une enum et une nouvelle table,
-- aucune table existante modifiée. À appliquer après #416.
CREATE TYPE "GameLevel" AS ENUM ('DEBUTANT', 'INTERMEDIAIRE', 'CONFIRME', 'COMPETITIF');

CREATE TABLE "UserGameLevel" (
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "level" "GameLevel" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGameLevel_pkey" PRIMARY KEY ("userId","gameId")
);

CREATE INDEX "UserGameLevel_gameId_level_idx" ON "UserGameLevel"("gameId", "level");

ALTER TABLE "UserGameLevel" ADD CONSTRAINT "UserGameLevel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserGameLevel" ADD CONSTRAINT "UserGameLevel_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
