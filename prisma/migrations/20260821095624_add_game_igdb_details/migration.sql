-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "igdbDetails" JSONB,
ADD COLUMN     "igdbDetailsFetchedAt" TIMESTAMP(3);

