ALTER TABLE "Session" ADD COLUMN "communityTeamId" TEXT;

CREATE INDEX "Session_communityTeamId_idx" ON "Session"("communityTeamId");

ALTER TABLE "Session"
ADD CONSTRAINT "Session_communityTeamId_fkey"
FOREIGN KEY ("communityTeamId") REFERENCES "CommunityTeam"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
