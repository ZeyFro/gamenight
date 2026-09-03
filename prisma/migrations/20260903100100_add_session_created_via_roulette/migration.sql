-- Sprint 3 : roue du gambling (/roulette) — marque les sessions créées via la roue.
ALTER TABLE "Session" ADD COLUMN "createdViaRoulette" BOOLEAN NOT NULL DEFAULT false;
