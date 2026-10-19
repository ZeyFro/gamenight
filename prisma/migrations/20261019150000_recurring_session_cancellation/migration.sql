ALTER TABLE "Session" ADD COLUMN "recurrenceGroupId" TEXT;

CREATE INDEX "Session_recurrenceGroupId_idx" ON "Session"("recurrenceGroupId");
