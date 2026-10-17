CREATE TYPE "CommunityHighlightKind" AS ENUM ('FAME', 'SHAME');
CREATE TABLE "CommunityHighlight" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "communityId" TEXT NOT NULL REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" "CommunityHighlightKind" NOT NULL,
  "title" VARCHAR(120) NOT NULL CHECK (char_length("title") > 0),
  "description" VARCHAR(4000) NOT NULL CHECK (char_length("description") > 0),
  "mediaUrl" VARCHAR(2048),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "CommunityHighlight_communityId_createdAt_idx" ON "CommunityHighlight"("communityId", "createdAt");
