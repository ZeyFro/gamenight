ALTER TYPE "XpReason" ADD VALUE 'SHOP_PURCHASE';

ALTER TABLE "CommunityMemberStats"
  ADD COLUMN "equippedTitleId" TEXT,
  ADD COLUMN "equippedFrameId" TEXT,
  ADD COLUMN "equippedColorId" TEXT;

CREATE TABLE "CommunityMemberCosmetic" (
  "communityId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityMemberCosmetic_pkey" PRIMARY KEY ("communityId", "userId", "itemId"),
  CONSTRAINT "CommunityMemberCosmetic_communityId_userId_fkey"
    FOREIGN KEY ("communityId", "userId")
    REFERENCES "CommunityMemberStats"("communityId", "userId")
    ON DELETE CASCADE ON UPDATE CASCADE
);
