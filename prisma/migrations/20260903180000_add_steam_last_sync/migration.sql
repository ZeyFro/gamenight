-- Fix bug remonté : indicateur "Dernière sync" pour la bibliothèque Steam.
ALTER TABLE "User" ADD COLUMN "steamLastSyncAt" TIMESTAMP(3);
