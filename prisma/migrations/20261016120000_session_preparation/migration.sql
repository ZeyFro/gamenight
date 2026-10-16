CREATE TABLE "SessionPreparation" (
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "installed" BOOLEAN NOT NULL DEFAULT false,
  "updated" BOOLEAN NOT NULL DEFAULT false,
  "microphone" BOOLEAN NOT NULL DEFAULT false,
  "lobby" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "SessionPreparation_pkey" PRIMARY KEY ("sessionId", "userId", "gameId"),
  CONSTRAINT "SessionPreparation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SessionPreparation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
