-- Retour arrière de *_voice_presence_gap_history : supprime "SessionVoicePresenceGap" (historique des lacunes).
-- Refuse si la table contient des lignes, sauf SET gamenight.allow_voice_data_loss = 'on' (après export).
BEGIN;
DO $$
BEGIN
  IF (SELECT count(*) FROM "SessionVoicePresenceGap") > 0
     AND coalesce(current_setting('gamenight.allow_voice_data_loss', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'Rollback interdit : SessionVoicePresenceGap contient % ligne(s). Exporter puis SET gamenight.allow_voice_data_loss = ''on''.',
      (SELECT count(*) FROM "SessionVoicePresenceGap");
  END IF;
END $$;
DROP TABLE "SessionVoicePresenceGap";
DELETE FROM "_prisma_migrations" WHERE "migration_name" LIKE '%\_voice_presence_gap_history';
COMMIT;
