CREATE TABLE "TournamentPrediction" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "voterId" TEXT NOT NULL,
  "predictedUserId" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TournamentPrediction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TournamentPrediction_tournamentId_target_voterId_key" ON "TournamentPrediction"("tournamentId", "target", "voterId");
CREATE INDEX "TournamentPrediction_communityId_idx" ON "TournamentPrediction"("communityId");
ALTER TABLE "TournamentPrediction" ADD CONSTRAINT "TournamentPrediction_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
