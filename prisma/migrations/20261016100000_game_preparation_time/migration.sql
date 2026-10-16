ALTER TABLE "Game"
  ADD COLUMN "preparationTimeMinutes" INTEGER,
  ADD CONSTRAINT "Game_preparationTimeMinutes_bounds"
    CHECK ("preparationTimeMinutes" IS NULL OR "preparationTimeMinutes" BETWEEN 1 AND 10080);
