ALTER TYPE "XpReason" ADD VALUE IF NOT EXISTS 'SESSION_ATTENDANCE';
ALTER TYPE "XpReason" ADD VALUE IF NOT EXISTS 'SESSION_ABSENCE';

ALTER TABLE "Community"
  ADD COLUMN "attendanceXpEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "attendanceBonusXp" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "absencePenaltyXp" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "SessionAttendance" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT,
  "communityId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "present" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionAttendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionAttendance_sessionId_userId_key" ON "SessionAttendance"("sessionId", "userId");
CREATE INDEX "SessionAttendance_communityId_userId_present_idx" ON "SessionAttendance"("communityId", "userId", "present");
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
