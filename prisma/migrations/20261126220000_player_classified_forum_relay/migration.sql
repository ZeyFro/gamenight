-- Relais forum des annonces joueurs (D3) : uniquement des ajouts.
ALTER TABLE "PlayerClassified"
  ADD COLUMN "forumThreadId" TEXT,
  ADD COLUMN "forumRelayedAt" TIMESTAMP(3),
  ADD COLUMN "forumClosedAt" TIMESTAMP(3),
  ADD COLUMN "pingedAt" TIMESTAMP(3);

CREATE INDEX "PlayerClassified_forumThreadId_idx" ON "PlayerClassified"("forumThreadId");

CREATE TABLE "PlayerClassifiedPing" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlayerClassifiedPing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlayerClassifiedPing_communityId_userId_day_key"
  ON "PlayerClassifiedPing"("communityId", "userId", "day");

CREATE INDEX "PlayerClassifiedPing_communityId_day_idx"
  ON "PlayerClassifiedPing"("communityId", "day");
