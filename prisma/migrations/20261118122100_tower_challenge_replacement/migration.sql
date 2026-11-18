-- Remplacement d'un défi solo dont le jeu n'est pas possédé (cahier 8.5-8.6). Migration additive : une nouvelle
-- table, aucune table existante modifiée. À appliquer après #416.
CREATE TABLE "TowerChallengeReplacement" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromDefinitionId" VARCHAR(191) NOT NULL,
    "toDefinitionId" VARCHAR(191) NOT NULL,
    "requiredGameId" VARCHAR(191) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TowerChallengeReplacement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TowerChallengeReplacement_attemptId_key" ON "TowerChallengeReplacement"("attemptId");
CREATE INDEX "TowerChallengeReplacement_communityId_userId_createdAt_idx" ON "TowerChallengeReplacement"("communityId", "userId", "createdAt");

ALTER TABLE "TowerChallengeReplacement" ADD CONSTRAINT "TowerChallengeReplacement_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerChallengeReplacement" ADD CONSTRAINT "TowerChallengeReplacement_attemptId_communityId_fkey" FOREIGN KEY ("attemptId", "communityId") REFERENCES "TowerChallengeAttempt"("id", "communityId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerChallengeReplacement" ADD CONSTRAINT "TowerChallengeReplacement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
