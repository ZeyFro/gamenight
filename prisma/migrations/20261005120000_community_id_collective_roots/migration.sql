-- Multi-communautés, PR7 (expand uniquement) : colonne `communityId` NULLABLE sur les
-- modèles collectifs racines (chat, dettes, wishlist, roulette, « Jouer maintenant »,
-- défis, récaps, saisons, succès et stats de groupe). Aucun backfill : NULL =
-- communauté par défaut. Aucun objet existant modifié ni rendu obligatoire.
-- Les clés uniques globales (ex. Season.number, GroupAchievement.key) restent
-- inchangées : elles seront revues par la PR qui rend chaque modèle multi-communauté.

-- AlterTable
ALTER TABLE "Roulette" ADD COLUMN     "communityId" TEXT;

-- AlterTable
ALTER TABLE "InstantSession" ADD COLUMN     "communityId" TEXT;

-- AlterTable
ALTER TABLE "WeeklyChallenge" ADD COLUMN     "communityId" TEXT;

-- AlterTable
ALTER TABLE "GroupAchievement" ADD COLUMN     "communityId" TEXT;

-- AlterTable
ALTER TABLE "Debt" ADD COLUMN     "communityId" TEXT;

-- AlterTable
ALTER TABLE "GroupSessionStats" ADD COLUMN     "communityId" TEXT;

-- AlterTable
ALTER TABLE "GroupGameStat" ADD COLUMN     "communityId" TEXT;

-- AlterTable
ALTER TABLE "GroupActiveWeek" ADD COLUMN     "communityId" TEXT;

-- AlterTable
ALTER TABLE "MonthlyRecap" ADD COLUMN     "communityId" TEXT;

-- AlterTable
ALTER TABLE "Season" ADD COLUMN     "communityId" TEXT;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "communityId" TEXT;

-- AlterTable
ALTER TABLE "GameWishlist" ADD COLUMN     "communityId" TEXT;

-- CreateIndex
CREATE INDEX "Roulette_communityId_idx" ON "Roulette"("communityId");

-- CreateIndex
CREATE INDEX "InstantSession_communityId_idx" ON "InstantSession"("communityId");

-- CreateIndex
CREATE INDEX "WeeklyChallenge_communityId_idx" ON "WeeklyChallenge"("communityId");

-- CreateIndex
CREATE INDEX "GroupAchievement_communityId_idx" ON "GroupAchievement"("communityId");

-- CreateIndex
CREATE INDEX "Debt_communityId_idx" ON "Debt"("communityId");

-- CreateIndex
CREATE INDEX "GroupSessionStats_communityId_idx" ON "GroupSessionStats"("communityId");

-- CreateIndex
CREATE INDEX "GroupGameStat_communityId_idx" ON "GroupGameStat"("communityId");

-- CreateIndex
CREATE INDEX "GroupActiveWeek_communityId_idx" ON "GroupActiveWeek"("communityId");

-- CreateIndex
CREATE INDEX "MonthlyRecap_communityId_idx" ON "MonthlyRecap"("communityId");

-- CreateIndex
CREATE INDEX "Season_communityId_idx" ON "Season"("communityId");

-- CreateIndex
CREATE INDEX "ChatMessage_communityId_idx" ON "ChatMessage"("communityId");

-- CreateIndex
CREATE INDEX "GameWishlist_communityId_idx" ON "GameWishlist"("communityId");

-- AddForeignKey
ALTER TABLE "Roulette" ADD CONSTRAINT "Roulette_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstantSession" ADD CONSTRAINT "InstantSession_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyChallenge" ADD CONSTRAINT "WeeklyChallenge_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAchievement" ADD CONSTRAINT "GroupAchievement_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSessionStats" ADD CONSTRAINT "GroupSessionStats_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupGameStat" ADD CONSTRAINT "GroupGameStat_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupActiveWeek" ADD CONSTRAINT "GroupActiveWeek_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyRecap" ADD CONSTRAINT "MonthlyRecap_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameWishlist" ADD CONSTRAINT "GameWishlist_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

