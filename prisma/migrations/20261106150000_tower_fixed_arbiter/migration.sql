-- Configuration préalable et journal des changements d'arbitre, sans effacement.
CREATE TABLE "TowerArbiterConfigurationChange" (
  "id" BIGSERIAL PRIMARY KEY,
  "communityId" TEXT NOT NULL,
  "previousArbiterUserId" TEXT,
  "arbiterUserId" TEXT NOT NULL,
  "changedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TowerArbiterConfigurationChange_communityId_fkey"
    FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TowerArbiterConfigurationChange_communityId_id_idx"
  ON "TowerArbiterConfigurationChange"("communityId", "id" DESC);
