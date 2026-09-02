-- Sprint 2 PR-C — migration purement additive : nouveau toggle son sur
-- User, nouvel enum NotificationType, nouvelle table Notification.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "soundEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('LEVEL_UP', 'BADGE', 'SESSION_RESULT', 'SESSION_CREATED', 'REMINDER');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "relatedSessionId" TEXT,
    "relatedBadgeId" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
