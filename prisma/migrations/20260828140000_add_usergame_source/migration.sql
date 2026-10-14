-- CreateEnum
CREATE TYPE "UserGameSource" AS ENUM ('PERSONAL', 'FAMILY', 'MANUAL');

-- AlterTable
ALTER TABLE "UserGame" ADD COLUMN     "source" "UserGameSource" NOT NULL DEFAULT 'PERSONAL';
