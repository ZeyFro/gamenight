-- Sélecteur de serveur (drapeau COMMUNITY_PICKER_ENABLED) : une colonne
-- NULLABLE sur "User", sans clé étrangère ni valeur par défaut, aucun objet
-- existant modifié, aucun backfill. Préférence d'affichage uniquement,
-- revalidée en code contre les Membership ACTIVE.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activeCommunityId" TEXT;
