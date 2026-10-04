-- Multi-communautés, PR3 (expand uniquement) : colonne `communityId` NULLABLE
-- sur Session et Tournament. Aucun backfill : `NULL` = communauté par défaut.
-- Aucun objet existant modifié ni rendu obligatoire.

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "communityId" TEXT;

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN "communityId" TEXT;

-- CreateIndex
CREATE INDEX "Session_communityId_idx" ON "Session"("communityId");

-- CreateIndex
CREATE INDEX "Tournament_communityId_idx" ON "Tournament"("communityId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;
