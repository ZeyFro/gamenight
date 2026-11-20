-- Tournois par équipes inscrites (TOURNAMENT_TEAMS_ENABLED). Additive : une enum et trois nouvelles tables, aucune table existante
-- modifiée (donc aucune lecture existante ne dépend de cette migration). Appliquée automatiquement après fusion dans main par
-- `migrate-production.yml` (docs/MIGRATIONS.md), jamais au build.
-- CreateEnum
CREATE TYPE "TournamentTeamEntryStatus" AS ENUM ('INVITED', 'REGISTERED', 'DECLINED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "TournamentTeamSettings" (
    "tournamentId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "maxTeams" INTEGER NOT NULL,
    "registrationClosesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentTeamSettings_pkey" PRIMARY KEY ("tournamentId")
);

-- CreateTable
CREATE TABLE "TournamentTeamEntry" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "status" "TournamentTeamEntryStatus" NOT NULL,
    "tournamentTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "TournamentTeamEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentMatchReport" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "winnerTeamId" TEXT NOT NULL,
    "score1" INTEGER,
    "score2" INTEGER,
    "reportedById" TEXT,
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentMatchReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TournamentTeamSettings_communityId_idx" ON "TournamentTeamSettings"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentTeamEntry_tournamentTeamId_key" ON "TournamentTeamEntry"("tournamentTeamId");

-- CreateIndex
CREATE INDEX "TournamentTeamEntry_communityId_teamId_idx" ON "TournamentTeamEntry"("communityId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentTeamEntry_tournamentId_teamId_key" ON "TournamentTeamEntry"("tournamentId", "teamId");

-- CreateIndex
CREATE INDEX "TournamentMatchReport_tournamentId_idx" ON "TournamentMatchReport"("tournamentId");

-- CreateIndex
CREATE INDEX "TournamentMatchReport_remindedAt_createdAt_idx" ON "TournamentMatchReport"("remindedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentMatchReport_matchId_teamId_key" ON "TournamentMatchReport"("matchId", "teamId");

-- AddForeignKey
ALTER TABLE "TournamentTeamSettings" ADD CONSTRAINT "TournamentTeamSettings_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeamSettings" ADD CONSTRAINT "TournamentTeamSettings_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeamEntry" ADD CONSTRAINT "TournamentTeamEntry_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeamEntry" ADD CONSTRAINT "TournamentTeamEntry_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeamEntry" ADD CONSTRAINT "TournamentTeamEntry_teamId_communityId_fkey" FOREIGN KEY ("teamId", "communityId") REFERENCES "CommunityTeam"("id", "communityId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeamEntry" ADD CONSTRAINT "TournamentTeamEntry_tournamentTeamId_fkey" FOREIGN KEY ("tournamentTeamId") REFERENCES "TournamentTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatchReport" ADD CONSTRAINT "TournamentMatchReport_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatchReport" ADD CONSTRAINT "TournamentMatchReport_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatchReport" ADD CONSTRAINT "TournamentMatchReport_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "TournamentMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatchReport" ADD CONSTRAINT "TournamentMatchReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
