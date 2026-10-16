-- Carnet facultatif ; vide/null = non renseigné pour les comptes existants.
ALTER TABLE "User"
  ADD COLUMN "inputDevices" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "availablePlatforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "microphoneAvailable" BOOLEAN;
