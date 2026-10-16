ALTER TABLE "Game"
  ADD COLUMN "preparationCost" VARCHAR(10),
  ADD COLUMN "preparationPrice" VARCHAR(120),
  ADD COLUMN "downloadSizeGb" DOUBLE PRECISION,
  ADD COLUMN "preparationPlatform" VARCHAR(80),
  ADD COLUMN "preparationSourceUrl" VARCHAR(500),
  ADD COLUMN "preparationUpdatedAt" TIMESTAMP(3);
