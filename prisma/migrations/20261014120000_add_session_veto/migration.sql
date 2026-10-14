-- CreateTable
CREATE TABLE "SessionVeto" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionVeto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionVeto_proposalId_idx" ON "SessionVeto"("proposalId");

-- CreateIndex
CREATE INDEX "SessionVeto_communityId_idx" ON "SessionVeto"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionVeto_sessionId_userId_key" ON "SessionVeto"("sessionId", "userId");

-- AddForeignKey
ALTER TABLE "SessionVeto" ADD CONSTRAINT "SessionVeto_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionVeto" ADD CONSTRAINT "SessionVeto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionVeto" ADD CONSTRAINT "SessionVeto_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionVeto" ADD CONSTRAINT "SessionVeto_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

