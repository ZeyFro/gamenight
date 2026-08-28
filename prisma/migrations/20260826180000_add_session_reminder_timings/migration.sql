-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "reminderTimings" INTEGER[] DEFAULT ARRAY[1440, 120]::INTEGER[];
