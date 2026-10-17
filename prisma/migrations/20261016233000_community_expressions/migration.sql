CREATE TABLE "CommunityExpression" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "meaning" VARCHAR(2000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityExpression_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunityExpression_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommunityExpression_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CommunityExpression_communityId_createdAt_idx" ON "CommunityExpression"("communityId", "createdAt");
