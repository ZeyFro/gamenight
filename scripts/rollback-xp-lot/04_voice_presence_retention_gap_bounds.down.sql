-- Retour arrière de *_voice_presence_retention_gap_bounds : supprime "SessionVoicePresenceControl"."gapStartedAt".
-- Refuse si une date de début de lacune est renseignée, sauf SET gamenight.allow_voice_data_loss = 'on'.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SessionVoicePresenceControl" WHERE "gapStartedAt" IS NOT NULL)
     AND coalesce(current_setting('gamenight.allow_voice_data_loss', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'Rollback interdit : des gapStartedAt sont renseignés. Exporter puis SET gamenight.allow_voice_data_loss = ''on''.';
  END IF;
END $$;
ALTER TABLE "SessionVoicePresenceControl" DROP COLUMN "gapStartedAt";
DELETE FROM "_prisma_migrations" WHERE "migration_name" LIKE '%\_voice_presence_retention_gap_bounds';
COMMIT;
