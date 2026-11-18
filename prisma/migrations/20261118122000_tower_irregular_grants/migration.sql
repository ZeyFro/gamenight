-- Irregular attribué manuellement par le staff (cahier 6.1). Migration additive : une enum et deux nouvelles
-- tables, aucune table existante modifiée. À appliquer après #416.
CREATE TYPE "TowerIrregularAction" AS ENUM ('GRANTED', 'REVOKED');

CREATE TABLE "TowerIrregularGrant" (
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedById" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "TowerIrregularGrant_pkey" PRIMARY KEY ("communityId", "userId")
);

CREATE TABLE "TowerIrregularLog" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" "TowerIrregularAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TowerIrregularLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TowerIrregularLog_communityId_userId_createdAt_idx" ON "TowerIrregularLog"("communityId", "userId", "createdAt");

ALTER TABLE "TowerIrregularGrant" ADD CONSTRAINT "TowerIrregularGrant_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerIrregularGrant" ADD CONSTRAINT "TowerIrregularGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerIrregularGrant" ADD CONSTRAINT "TowerIrregularGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TowerIrregularGrant" ADD CONSTRAINT "TowerIrregularGrant_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TowerIrregularLog" ADD CONSTRAINT "TowerIrregularLog_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerIrregularLog" ADD CONSTRAINT "TowerIrregularLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TowerIrregularLog" ADD CONSTRAINT "TowerIrregularLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
