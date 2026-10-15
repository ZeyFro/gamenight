-- CreateEnum
CREATE TYPE "SessionAvailabilityPollStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SessionAvailabilityPollAnswer" AS ENUM ('AVAILABLE', 'MAYBE', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "SessionAvailabilityPoll" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "status" "SessionAvailabilityPollStatus" NOT NULL DEFAULT 'OPEN',
    "sessionId" TEXT,
    "chosenSlotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionAvailabilityPoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionAvailabilityPollParticipant" (
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SessionAvailabilityPollParticipant_pkey" PRIMARY KEY ("pollId","userId")
);

-- CreateTable
CREATE TABLE "SessionAvailabilityPollSlot" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionAvailabilityPollSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionAvailabilityPollResponse" (
    "pollId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answer" "SessionAvailabilityPollAnswer" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionAvailabilityPollResponse_pkey" PRIMARY KEY ("pollId","slotId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionAvailabilityPoll_sessionId_key" ON "SessionAvailabilityPoll"("sessionId");

-- CreateIndex
CREATE INDEX "SessionAvailabilityPoll_communityId_createdAt_idx" ON "SessionAvailabilityPoll"("communityId", "createdAt");

-- CreateIndex
CREATE INDEX "SessionAvailabilityPoll_createdById_status_idx" ON "SessionAvailabilityPoll"("createdById", "status");

-- CreateIndex
CREATE INDEX "SessionAvailabilityPollParticipant_userId_idx" ON "SessionAvailabilityPollParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionAvailabilityPollSlot_pollId_id_key" ON "SessionAvailabilityPollSlot"("pollId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SessionAvailabilityPollSlot_pollId_start_end_key" ON "SessionAvailabilityPollSlot"("pollId", "start", "end");

-- CreateIndex
CREATE INDEX "SessionAvailabilityPollResponse_pollId_userId_idx" ON "SessionAvailabilityPollResponse"("pollId", "userId");

-- AddForeignKey
ALTER TABLE "SessionAvailabilityPoll" ADD CONSTRAINT "SessionAvailabilityPoll_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAvailabilityPoll" ADD CONSTRAINT "SessionAvailabilityPoll_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAvailabilityPoll" ADD CONSTRAINT "SessionAvailabilityPoll_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAvailabilityPoll" ADD CONSTRAINT "SessionAvailabilityPoll_id_chosenSlotId_fkey" FOREIGN KEY ("id", "chosenSlotId") REFERENCES "SessionAvailabilityPollSlot"("pollId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SessionAvailabilityPollParticipant" ADD CONSTRAINT "SessionAvailabilityPollParticipant_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "SessionAvailabilityPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAvailabilityPollParticipant" ADD CONSTRAINT "SessionAvailabilityPollParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAvailabilityPollSlot" ADD CONSTRAINT "SessionAvailabilityPollSlot_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "SessionAvailabilityPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAvailabilityPollResponse" ADD CONSTRAINT "SessionAvailabilityPollResponse_pollId_slotId_fkey" FOREIGN KEY ("pollId", "slotId") REFERENCES "SessionAvailabilityPollSlot"("pollId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAvailabilityPollResponse" ADD CONSTRAINT "SessionAvailabilityPollResponse_pollId_userId_fkey" FOREIGN KEY ("pollId", "userId") REFERENCES "SessionAvailabilityPollParticipant"("pollId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Une option couvre une durée positive ; les bornes produit sont validées
-- à la création, avant toute écriture.
ALTER TABLE "SessionAvailabilityPollSlot" ADD CONSTRAINT "SessionAvailabilityPollSlot_positive_duration" CHECK ("end" > "start");
