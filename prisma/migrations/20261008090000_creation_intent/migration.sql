CREATE TABLE "CreationIntent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreationIntent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CreationIntent_actorId_kind_key_key" ON "CreationIntent"("actorId", "kind", "key");
