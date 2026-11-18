-- Retour arrière de *_voice_presence_consent_coordination : supprime consentements, contrôle, enum et les colonnes
-- consentId / endedAt / expiresAt de "SessionVoicePresenceInterval". Exige que 05 et 04 soient déjà annulées.
-- Refuse si des consentements, contrôles ou intervalles existent, sauf SET gamenight.allow_voice_data_loss = 'on'.
BEGIN;
DO $$
BEGIN
  IF to_regclass('"SessionVoicePresenceGap"') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback interdit : annuler d''abord 05 (SessionVoicePresenceGap existe).';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'SessionVoicePresenceControl' AND column_name = 'gapStartedAt') THEN
    RAISE EXCEPTION 'Rollback interdit : annuler d''abord 04 (gapStartedAt existe).';
  END IF;
  IF ((SELECT count(*) FROM "SessionVoicePresenceConsent") + (SELECT count(*) FROM "SessionVoicePresenceControl")
      + (SELECT count(*) FROM "SessionVoicePresenceInterval")) > 0
     AND coalesce(current_setting('gamenight.allow_voice_data_loss', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'Rollback interdit : consentements (%), contrôles (%) ou intervalles (%) présents. Exporter puis SET gamenight.allow_voice_data_loss = ''on''.',
      (SELECT count(*) FROM "SessionVoicePresenceConsent"), (SELECT count(*) FROM "SessionVoicePresenceControl"),
      (SELECT count(*) FROM "SessionVoicePresenceInterval");
  END IF;
END $$;
ALTER TABLE "SessionVoicePresenceInterval" DROP CONSTRAINT "SessionVoicePresenceInterval_consentId_fkey";
DROP TABLE "SessionVoicePresenceControl";
DROP TABLE "SessionVoicePresenceConsent";
ALTER TABLE "SessionVoicePresenceInterval" DROP COLUMN "consentId", DROP COLUMN "endedAt", DROP COLUMN "expiresAt";
DROP TYPE "SessionVoicePresenceControlStatus";
DELETE FROM "_prisma_migrations" WHERE "migration_name" LIKE '%\_voice_presence_consent_coordination';
COMMIT;
