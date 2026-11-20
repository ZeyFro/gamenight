-- Objectifs et critères de recrutement d'équipe (cahier §11.2). Migration additive : trois enums et une
-- nouvelle table, aucune table existante modifiée. À appliquer après #416 (CommunityTeam reste inchangée).
CREATE TYPE "TeamGoal" AS ENUM ('DETENTE', 'COMPETITIF', 'PROGRESSION', 'DECOUVERTE', 'SOCIAL');
CREATE TYPE "TeamMicRequirement" AS ENUM ('REQUIRED', 'PREFERRED', 'NOT_NEEDED');
CREATE TYPE "TeamAvailabilitySlot" AS ENUM ('WEEKDAY_DAY', 'WEEKDAY_EVENING', 'WEEKEND_DAY', 'WEEKEND_EVENING', 'NIGHT');

CREATE TABLE "TeamRecruitmentCriteria" (
    "teamId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "goals" "TeamGoal"[],
    "minLevel" VARCHAR(20),
    "mic" "TeamMicRequirement",
    "slots" "TeamAvailabilitySlot"[],
    "platforms" TEXT[],
    "note" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamRecruitmentCriteria_pkey" PRIMARY KEY ("teamId")
);

CREATE UNIQUE INDEX "TeamRecruitmentCriteria_teamId_communityId_key" ON "TeamRecruitmentCriteria"("teamId", "communityId");
CREATE INDEX "TeamRecruitmentCriteria_communityId_idx" ON "TeamRecruitmentCriteria"("communityId");

ALTER TABLE "TeamRecruitmentCriteria" ADD CONSTRAINT "TeamRecruitmentCriteria_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamRecruitmentCriteria" ADD CONSTRAINT "TeamRecruitmentCriteria_teamId_communityId_fkey" FOREIGN KEY ("teamId", "communityId") REFERENCES "CommunityTeam"("id", "communityId") ON DELETE CASCADE ON UPDATE CASCADE;
