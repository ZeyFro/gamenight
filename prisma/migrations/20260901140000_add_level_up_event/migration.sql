-- CreateTable
CREATE TABLE "LevelUpEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LevelUpEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LevelUpEvent_createdAt_idx" ON "LevelUpEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "LevelUpEvent" ADD CONSTRAINT "LevelUpEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
