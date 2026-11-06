ALTER TABLE "Community" ADD COLUMN "communityTeamsEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CommunityTeam" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "platform" VARCHAR(40) NOT NULL,
    "maxMembers" INTEGER NOT NULL,
    "isRecruiting" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityTeam_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityTeamMember" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityTeamMember_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommunityTeam_communityId_isRecruiting_createdAt_idx" ON "CommunityTeam"("communityId", "isRecruiting", "createdAt");
CREATE INDEX "CommunityTeam_createdById_communityId_idx" ON "CommunityTeam"("createdById", "communityId");
CREATE UNIQUE INDEX "CommunityTeam_id_communityId_key" ON "CommunityTeam"("id", "communityId");
CREATE UNIQUE INDEX "CommunityTeamMember_teamId_userId_key" ON "CommunityTeamMember"("teamId", "userId");
CREATE INDEX "CommunityTeamMember_communityId_userId_idx" ON "CommunityTeamMember"("communityId", "userId");

ALTER TABLE "CommunityTeam" ADD CONSTRAINT "CommunityTeam_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityTeam" ADD CONSTRAINT "CommunityTeam_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityTeam" ADD CONSTRAINT "CommunityTeam_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityTeamMember" ADD CONSTRAINT "CommunityTeamMember_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityTeamMember" ADD CONSTRAINT "CommunityTeamMember_teamId_communityId_fkey" FOREIGN KEY ("teamId", "communityId") REFERENCES "CommunityTeam"("id", "communityId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityTeamMember" ADD CONSTRAINT "CommunityTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
