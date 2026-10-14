-- CreateTable
CREATE TABLE "RouletteVeto" (
    "id" TEXT NOT NULL,
    "rouletteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouletteVeto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RouletteVeto_communityId_idx" ON "RouletteVeto"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "RouletteVeto_rouletteId_userId_key" ON "RouletteVeto"("rouletteId", "userId");

-- AddForeignKey
ALTER TABLE "RouletteVeto" ADD CONSTRAINT "RouletteVeto_rouletteId_fkey" FOREIGN KEY ("rouletteId") REFERENCES "Roulette"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouletteVeto" ADD CONSTRAINT "RouletteVeto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouletteVeto" ADD CONSTRAINT "RouletteVeto_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
