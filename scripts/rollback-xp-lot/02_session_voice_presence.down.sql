-- Retour arrière de *_session_voice_presence : supprime "SessionVoicePresenceInterval". Exige que 03 soit déjà annulée.
-- Refuse si des intervalles existent, sauf SET gamenight.allow_voice_data_loss = 'on' (après export).
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'SessionVoicePresenceInterval' AND column_name = 'consentId') THEN
    RAISE EXCEPTION 'Rollback interdit : annuler d''abord 03 (consentId existe).';
  END IF;
  IF (SELECT count(*) FROM "SessionVoicePresenceInterval") > 0
     AND coalesce(current_setting('gamenight.allow_voice_data_loss', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'Rollback interdit : SessionVoicePresenceInterval contient % ligne(s). Exporter puis SET gamenight.allow_voice_data_loss = ''on''.',
      (SELECT count(*) FROM "SessionVoicePresenceInterval");
  END IF;
END $$;
DROP TABLE "SessionVoicePresenceInterval";
DELETE FROM "_prisma_migrations" WHERE "migration_name" LIKE '%\_session_voice_presence';
COMMIT;
