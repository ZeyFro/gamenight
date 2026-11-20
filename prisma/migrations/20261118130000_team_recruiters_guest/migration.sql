-- Recruteurs d'équipe, relance/expiration des candidatures et invités de tournoi (TEAM_RECRUITERS_ENABLED).
-- Additive : une valeur d'enum, une colonne nullable, deux nouvelles tables. Aucune ligne existante modifiée.
-- Appliquée automatiquement après fusion dans main par `migrate-production.yml` (docs/MIGRATIONS.md), jamais au build.
ALTER TYPE "TeamApplicationStatus" ADD VALUE 'EXPIRED';

ALTER TABLE "TeamApplication" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
CREATE INDEX "TeamApplication_status_createdAt_idx" ON "TeamApplication"("status", "createdAt");

CREATE TYPE "TeamGuestStatus" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED', 'REVOKED');

CREATE TABLE "CommunityTeamRecruiter" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "namedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityTeamRecruiter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityTeamRecruiter_teamId_userId_key" ON "CommunityTeamRecruiter"("teamId", "userId");
CREATE INDEX "CommunityTeamRecruiter_communityId_userId_idx" ON "CommunityTeamRecruiter"("communityId", "userId");

ALTER TABLE "CommunityTeamRecruiter" ADD CONSTRAINT "CommunityTeamRecruiter_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityTeamRecruiter" ADD CONSTRAINT "CommunityTeamRecruiter_teamId_communityId_fkey" FOREIGN KEY ("teamId", "communityId") REFERENCES "CommunityTeam"("id", "communityId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityTeamRecruiter" ADD CONSTRAINT "CommunityTeamRecruiter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityTeamRecruiter" ADD CONSTRAINT "CommunityTeamRecruiter_namedById_fkey" FOREIGN KEY ("namedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TeamTournamentGuest" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedById" TEXT,
    "status" "TeamGuestStatus" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "TeamTournamentGuest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamTournamentGuest_tournamentId_userId_key" ON "TeamTournamentGuest"("tournamentId", "userId");
CREATE INDEX "TeamTournamentGuest_teamId_tournamentId_status_idx" ON "TeamTournamentGuest"("teamId", "tournamentId", "status");
CREATE INDEX "TeamTournamentGuest_communityId_userId_idx" ON "TeamTournamentGuest"("communityId", "userId");

ALTER TABLE "TeamTournamentGuest" ADD CONSTRAINT "TeamTournamentGuest_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamTournamentGuest" ADD CONSTRAINT "TeamTournamentGuest_teamId_communityId_fkey" FOREIGN KEY ("teamId", "communityId") REFERENCES "CommunityTeam"("id", "communityId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamTournamentGuest" ADD CONSTRAINT "TeamTournamentGuest_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamTournamentGuest" ADD CONSTRAINT "TeamTournamentGuest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamTournamentGuest" ADD CONSTRAINT "TeamTournamentGuest_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
