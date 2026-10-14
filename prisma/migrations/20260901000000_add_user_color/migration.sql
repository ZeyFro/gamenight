-- AlterTable
ALTER TABLE "User" ADD COLUMN     "color" TEXT NOT NULL DEFAULT '#8b5cf6',
ADD COLUMN     "colorCustomized" BOOLEAN NOT NULL DEFAULT false;
