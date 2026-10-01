-- V2 (MP roulette) — catégorie d'événement de notification dédiée à la
-- roulette. Une roulette n'a ni `Session` ni fil : ses MP ne peuvent pas
-- s'adosser à la catégorie SESSION (le résolveur SESSION charge une
-- `Session` par `sourceId`). Ajout d'une valeur d'enum seule, purement
-- additif — aucune ligne existante n'est touchée, aucun backfill (les
-- préférences ROULETTE existent déjà côté `UserNotificationCategory`).
ALTER TYPE "NotificationCategory" ADD VALUE 'ROULETTE';
