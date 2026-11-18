-- Visibilité du profil (cahier §12.3). Migration additive : une enum et une table, aucune table existante
-- modifiée. À appliquer après #416. Pas de ligne = visibilité COMMUNITY (comportement actuel).
CREATE TYPE "ProfileVisibility" AS ENUM ('COMMUNITY', 'HIDDEN');

CREATE TABLE "UserProfileVisibility" (
    "userId" TEXT NOT NULL,
    "visibility" "ProfileVisibility" NOT NULL DEFAULT 'COMMUNITY',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfileVisibility_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserProfileVisibility" ADD CONSTRAINT "UserProfileVisibility_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
