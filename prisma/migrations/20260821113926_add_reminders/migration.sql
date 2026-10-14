-- AlterTable
ALTER TABLE "User" ADD COLUMN     "silenceReminders" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "customReminderMessage" TEXT,
ADD COLUMN     "remindersSent" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "ReminderTemplate" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderTemplate_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ReminderTemplate" ADD CONSTRAINT "ReminderTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

