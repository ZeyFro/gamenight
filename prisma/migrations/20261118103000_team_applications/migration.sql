-- Candidatures d'équipe (cahier §11.1). Migration additive : une nouvelle enum et une nouvelle table,
-- aucune table existante modifiée. À appliquer après #416 (et après #370, dont la table CommunityTeam
-- reste inchangée ici).
CREATE TYPE "TeamApplicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

CREATE TABLE "TeamApplication" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "status" "TeamApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "TeamApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamApplication_teamId_applicantId_key" ON "TeamApplication"("teamId", "applicantId");
CREATE INDEX "TeamApplication_communityId_teamId_status_idx" ON "TeamApplication"("communityId", "teamId", "status");
CREATE INDEX "TeamApplication_applicantId_communityId_idx" ON "TeamApplication"("applicantId", "communityId");

ALTER TABLE "TeamApplication" ADD CONSTRAINT "TeamApplication_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamApplication" ADD CONSTRAINT "TeamApplication_teamId_communityId_fkey" FOREIGN KEY ("teamId", "communityId") REFERENCES "CommunityTeam"("id", "communityId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamApplication" ADD CONSTRAINT "TeamApplication_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamApplication" ADD CONSTRAINT "TeamApplication_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
