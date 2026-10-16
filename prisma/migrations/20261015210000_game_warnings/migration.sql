ALTER TABLE "Game"
  ADD COLUMN "jumpscares" BOOLEAN,
  ADD COLUMN "motionSickness" BOOLEAN,
  ADD COLUMN "textLanguages" VARCHAR(120),
  ADD COLUMN "audioLanguages" VARCHAR(120),
  ADD COLUMN "warningsUpdatedAt" TIMESTAMP(3);
