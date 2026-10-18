CREATE TABLE "CommunityQuickPoll" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "question" VARCHAR(200) NOT NULL,
  "options" TEXT[] NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityQuickPoll_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunityQuickPoll_options_bounds" CHECK (cardinality("options") BETWEEN 2 AND 6),
  CONSTRAINT "CommunityQuickPoll_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommunityQuickPoll_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CommunityQuickPoll_id_communityId_key" ON "CommunityQuickPoll"("id", "communityId");
CREATE INDEX "CommunityQuickPoll_communityId_createdAt_idx" ON "CommunityQuickPoll"("communityId", "createdAt");

CREATE TABLE "CommunityQuickPollVote" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "pollId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "optionIndex" INTEGER NOT NULL,
  CONSTRAINT "CommunityQuickPollVote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunityQuickPollVote_optionIndex_bounds" CHECK ("optionIndex" BETWEEN 0 AND 5),
  CONSTRAINT "CommunityQuickPollVote_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommunityQuickPollVote_pollId_communityId_fkey" FOREIGN KEY ("pollId", "communityId") REFERENCES "CommunityQuickPoll"("id", "communityId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommunityQuickPollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CommunityQuickPollVote_pollId_userId_key" ON "CommunityQuickPollVote"("pollId", "userId");
CREATE INDEX "CommunityQuickPollVote_communityId_pollId_idx" ON "CommunityQuickPollVote"("communityId", "pollId");
