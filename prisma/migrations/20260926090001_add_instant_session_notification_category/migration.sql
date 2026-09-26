-- V2 ("Jouer maintenant") — nouvelle catégorie de préférence pilotable
-- depuis le profil, distincte de SESSION (règle produit explicite). Le
-- backfill (`enabled = NOT silenceReminders`) est posé dans une migration
-- SÉPARÉE (fichier suivant) : PostgreSQL interdit d'utiliser une valeur
-- d'enum tout juste ajoutée par ALTER TYPE ... ADD VALUE dans LA MÊME
-- transaction — même contrainte déjà rencontrée pour TOURMANENT (voir
-- `20260922090000_add_tournament_v2`/`20260922090001_backfill_tournament_notification_preferences`).
ALTER TYPE "UserNotificationCategory" ADD VALUE 'INSTANT_SESSION';
