-- AlterEnum
ALTER TYPE "XpReason" ADD VALUE 'ADMIN_ADJUSTMENT';

-- CreateTable
CREATE TABLE "XpAdjustment" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "oldXp" INTEGER NOT NULL,
    "newXp" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "XpAdjustment_communityId_userId_createdAt_idx" ON "XpAdjustment"("communityId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "XpAdjustment_createdAt_idx" ON "XpAdjustment"("createdAt");
