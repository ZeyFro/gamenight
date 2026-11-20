-- Console (sujet J). Migration additive : colonnes nullable/avec défaut et une nouvelle table.
-- Identifiant Riot facultatif, plateformes et crossplay déclarés sur la fiche jeu, suggestions
-- d'identifiants issues du scope Discord `connections` (jamais appliquées sans accord du membre).
ALTER TABLE "User" ADD COLUMN "riotId" VARCHAR(100);

ALTER TABLE "Game" ADD COLUMN "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "crossplay" BOOLEAN;

-- Un jeu importé de Steam existe forcément sur PC : seule affirmation sûre, aucune autre plateforme déduite.
UPDATE "Game" SET "platforms" = ARRAY['WINDOWS']::TEXT[] WHERE "source" = 'STEAM';

CREATE TABLE "PlatformConnectionSuggestion" (
    "userId" TEXT NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "value" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformConnectionSuggestion_pkey" PRIMARY KEY ("userId","platform")
);

ALTER TABLE "PlatformConnectionSuggestion" ADD CONSTRAINT "PlatformConnectionSuggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
