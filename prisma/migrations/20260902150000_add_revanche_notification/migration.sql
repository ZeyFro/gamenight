-- Sprint 3 (FEATURE 3) : suggestion de revanche automatique.
ALTER TYPE "NotificationType" ADD VALUE 'REVANCHE';

ALTER TABLE "Notification" ADD COLUMN "relatedGameId" TEXT;
