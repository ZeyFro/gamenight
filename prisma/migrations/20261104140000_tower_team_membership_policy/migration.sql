-- Un membre ne peut appartenir qu'à une équipe par communauté.
-- Avant toute migration en production, vérifier qu'aucun doublon historique
-- n'empêche la création de l'index unique. Aucun nettoyage automatique.
ALTER TABLE "Membership" ADD COLUMN "lastTeamLeftAt" TIMESTAMP(3);
ALTER TABLE "CommunityTeam" ADD COLUMN "captainLastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "CommunityTeamMember_communityId_userId_key"
  ON "CommunityTeamMember"("communityId", "userId");
