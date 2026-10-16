CREATE TYPE "CommunityDateKind" AS ENUM ('BIRTHDAY', 'IMPORTANT');

CREATE TABLE "CommunityDate" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "memberId" TEXT,
    "kind" "CommunityDateKind" NOT NULL,
    "title" VARCHAR(100),
    "date" DATE NOT NULL,
    "repeatsAnnually" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityDate_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CommunityDate" ADD CONSTRAINT "CommunityDate_shape_check" CHECK (
    ("kind" = 'BIRTHDAY' AND "memberId" IS NOT NULL AND "title" IS NULL AND "createdById" = "memberId" AND "repeatsAnnually" AND EXTRACT(YEAR FROM "date") = 2000)
    OR ("kind" = 'IMPORTANT' AND "memberId" IS NULL AND "title" IS NOT NULL)
);

CREATE UNIQUE INDEX "CommunityDate_communityId_memberId_key" ON "CommunityDate"("communityId", "memberId");
CREATE INDEX "CommunityDate_communityId_date_idx" ON "CommunityDate"("communityId", "date");

ALTER TABLE "CommunityDate" ADD CONSTRAINT "CommunityDate_communityId_fkey"
    FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityDate" ADD CONSTRAINT "CommunityDate_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityDate" ADD CONSTRAINT "CommunityDate_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
