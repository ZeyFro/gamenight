ALTER TABLE "CommunityTeam" DROP CONSTRAINT "CommunityTeam_gameId_fkey";
ALTER TABLE "CommunityTeam"
  ADD CONSTRAINT "CommunityTeam_gameId_fkey"
  FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
