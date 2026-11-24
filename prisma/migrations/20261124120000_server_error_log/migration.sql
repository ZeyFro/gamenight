-- CreateTable
CREATE TABLE "ServerErrorLog" (
    "id" TEXT NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "context" VARCHAR(64) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "route" VARCHAR(96),
    "message" VARCHAR(300) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServerErrorLog_fingerprint_key" ON "ServerErrorLog"("fingerprint");

-- CreateIndex
CREATE INDEX "ServerErrorLog_lastAt_idx" ON "ServerErrorLog"("lastAt");

