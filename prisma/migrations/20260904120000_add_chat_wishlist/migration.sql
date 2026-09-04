-- Sprint 5 (Chat in-app + Wishlist) — migration purement additive.

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameWishlist" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "proposedById" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purchasedById" TEXT,
    "purchasedAt" TIMESTAMP(3),

    CONSTRAINT "GameWishlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameWishlistVote" (
    "id" TEXT NOT NULL,
    "wishlistId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "interested" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameWishlistVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatReaction_messageId_userId_key" ON "ChatReaction"("messageId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GameWishlist_gameId_key" ON "GameWishlist"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "GameWishlistVote_wishlistId_userId_key" ON "GameWishlistVote"("wishlistId", "userId");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatReaction" ADD CONSTRAINT "ChatReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatReaction" ADD CONSTRAINT "ChatReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameWishlist" ADD CONSTRAINT "GameWishlist_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameWishlist" ADD CONSTRAINT "GameWishlist_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameWishlist" ADD CONSTRAINT "GameWishlist_purchasedById_fkey" FOREIGN KEY ("purchasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameWishlistVote" ADD CONSTRAINT "GameWishlistVote_wishlistId_fkey" FOREIGN KEY ("wishlistId") REFERENCES "GameWishlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameWishlistVote" ADD CONSTRAINT "GameWishlistVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
