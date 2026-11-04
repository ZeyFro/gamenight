-- Un membre ne peut appartenir qu'à une équipe par communauté.
-- Avant toute migration en production, vérifier qu'aucun doublon historique
-- n'empêche la création de l'index unique. Aucun nettoyage automatique.
ALTER TABLE "Membership" ADD COLUMN "lastTeamLeftAt" TIMESTAMP(3);
ALTER TABLE "CommunityTeam" ADD COLUMN "captainLastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "CommunityTeamMember_communityId_userId_key"
  ON "CommunityTeamMember"("communityId", "userId");

-- Capitaine distinct du fondateur historique : copier les responsables existants.
ALTER TABLE "CommunityTeam" ADD COLUMN "captainId" TEXT;
UPDATE "CommunityTeam" SET "captainId" = "createdById";
ALTER TABLE "CommunityTeam" ADD CONSTRAINT "CommunityTeam_captainId_fkey"
  FOREIGN KEY ("captainId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
