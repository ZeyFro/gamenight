-- Migration isolée : capitaine durable distinct du créateur historique.
-- `createdById` n'est JAMAIS modifié par une passation.
-- À appliquer uniquement sur une base de test jetable avant toute Production.

ALTER TABLE "CommunityTeam" ADD COLUMN "captainId" TEXT;

CREATE INDEX "CommunityTeam_captainId_idx" ON "CommunityTeam"("captainId");
