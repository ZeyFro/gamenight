ALTER TABLE "Community" ADD COLUMN "sessionGalleryEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SessionGalleryMedia" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "pathname" TEXT NOT NULL,
  "mimeType" VARCHAR(32) NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionGalleryMedia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SessionGalleryMedia_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SessionGalleryMedia_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SessionGalleryMedia_pathname_key" ON "SessionGalleryMedia"("pathname");
CREATE INDEX "SessionGalleryMedia_sessionId_createdAt_idx" ON "SessionGalleryMedia"("sessionId", "createdAt");
