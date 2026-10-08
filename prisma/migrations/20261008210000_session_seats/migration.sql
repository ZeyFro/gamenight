-- Additif : aucune réécriture des votes ni des soirées historiques.
ALTER TABLE "Session" ADD COLUMN "attendanceCapacity" INTEGER;
ALTER TABLE "Session" ADD CONSTRAINT "Session_attendanceCapacity_check" CHECK ("attendanceCapacity" BETWEEN 1 AND 100);
CREATE TYPE "SessionSeatStatus" AS ENUM ('CONFIRMED', 'WAITLIST', 'DECLINED');
CREATE TABLE "SessionSeat" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "SessionSeatStatus" NOT NULL DEFAULT 'WAITLIST',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionSeat_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SessionSeat_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SessionSeat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SessionSeat_sessionId_userId_key" ON "SessionSeat"("sessionId", "userId");
CREATE INDEX "SessionSeat_sessionId_status_requestedAt_idx" ON "SessionSeat"("sessionId", "status", "requestedAt");
