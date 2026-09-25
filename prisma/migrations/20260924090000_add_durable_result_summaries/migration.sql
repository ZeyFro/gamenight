-- Chantier nettoyage réel du stockage (V2, suite) — complète #107 : la
-- réduction demandée porte sur les historiques RÉELS (Session/Tournament
-- et leurs données détaillées), pas seulement les messages de chat déjà
-- traités. Cette migration prépare le terrain en rendant purgeable la
-- ligne `Session` elle-même SANS perdre les résultats/récompenses/stats
-- qui en dépendent encore aujourd'hui via une relation `onDelete: Cascade` —
-- voir le README ("Résumé durable minimal") pour l'analyse complète des
-- dépendances. AUCUNE ligne n'est déplacée dans une table d'archive : les
-- 4 modèles ci-dessous restent exactement ce qu'ils sont, seule leur
-- relation vers `Session` passe de CASCADE à SET NULL, et 5 colonnes
-- dénormalisées (déjà connues au moment de l'écriture initiale, jamais
-- recalculées) leur évitent de dépendre d'une jointure vers une ligne qui
-- pourra disparaître.

-- ============================================================
-- SessionResult — podium, résumé durable pour /profil/historique,
-- /profil (win rate, jeu le plus joué) et revanche.ts.
-- ============================================================
ALTER TABLE "SessionResult" DROP CONSTRAINT "SessionResult_sessionId_fkey";
ALTER TABLE "SessionResult" ALTER COLUMN "sessionId" DROP NOT NULL;
ALTER TABLE "SessionResult" ADD COLUMN "gameId" TEXT;
ALTER TABLE "SessionResult" ADD COLUMN "gameName" TEXT;
ALTER TABLE "SessionResult" ADD COLUMN "sessionDate" TIMESTAMP(3);

-- Backfill des lignes déjà existantes — la soirée existe ENCORE à cet
-- instant (cette migration s'exécute avant toute purge), donc la
-- jointure est fiable à 100% ici, une seule fois, jamais répétée ensuite.
UPDATE "SessionResult" AS sr
SET "gameId" = s."decidedGameId",
    "gameName" = g."name",
    "sessionDate" = s."date"
FROM "Session" AS s
LEFT JOIN "Game" AS g ON g."id" = s."decidedGameId"
WHERE s."id" = sr."sessionId";

ALTER TABLE "SessionResult"
  ADD CONSTRAINT "SessionResult_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SessionResult_userId_gameId_idx" ON "SessionResult"("userId", "gameId");

-- ============================================================
-- SuperlativeAward — vitrine "Superlatifs gagnés" (/profil/superlatifs,
-- /potes/[id]/superlatifs, Home).
-- ============================================================
ALTER TABLE "SuperlativeAward" DROP CONSTRAINT "SuperlativeAward_sessionId_fkey";
ALTER TABLE "SuperlativeAward" ALTER COLUMN "sessionId" DROP NOT NULL;
ALTER TABLE "SuperlativeAward" ADD COLUMN "gameName" TEXT;
ALTER TABLE "SuperlativeAward" ADD COLUMN "sessionDate" TIMESTAMP(3);

UPDATE "SuperlativeAward" AS sa
SET "gameName" = g."name",
    "sessionDate" = s."date"
FROM "Session" AS s
LEFT JOIN "Game" AS g ON g."id" = s."decidedGameId"
WHERE s."id" = sa."sessionId";

ALTER TABLE "SuperlativeAward"
  ADD CONSTRAINT "SuperlativeAward_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Pronostic — taux de réussite à vie (/profil). Aucune colonne
-- dénormalisée nécessaire (jamais affiché avec un contexte de jeu/soirée
-- individuel, seulement agrégé par `correct`).
-- ============================================================
ALTER TABLE "Pronostic" DROP CONSTRAINT "Pronostic_sessionId_fkey";
ALTER TABLE "Pronostic" ALTER COLUMN "sessionId" DROP NOT NULL;
ALTER TABLE "Pronostic"
  ADD CONSTRAINT "Pronostic_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- XpBet — historique des 5 paris résolus les plus récents + somme des
-- gains à vie (/profil).
-- ============================================================
ALTER TABLE "XpBet" DROP CONSTRAINT "XpBet_sessionId_fkey";
ALTER TABLE "XpBet" ALTER COLUMN "sessionId" DROP NOT NULL;
ALTER TABLE "XpBet" ADD COLUMN "gameName" TEXT;

UPDATE "XpBet" AS xb
SET "gameName" = g."name"
FROM "Session" AS s
LEFT JOIN "Game" AS g ON g."id" = s."decidedGameId"
WHERE s."id" = xb."sessionId";

ALTER TABLE "XpBet"
  ADD CONSTRAINT "XpBet_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- UserLifetimeStats — résumé durable MINIMAL (un seul compteur à ce
-- jour) pour "tournois joués" (TournamentParticipant, lui, reste
-- intégralement cascadé avec Tournament — aucune autre lecture durable
-- n'en dépend, voir le README).
-- ============================================================
CREATE TABLE "UserLifetimeStats" (
    "userId" TEXT NOT NULL,
    "tournamentsParticipatedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UserLifetimeStats_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserLifetimeStats"
  ADD CONSTRAINT "UserLifetimeStats_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill — une ligne par user ayant déjà au moins une inscription à un
-- tournoi, comptée UNE SEULE FOIS ici (jamais recalculée après coup, le
-- compteur avance ensuite exclusivement par incrément/décrément explicite
-- à l'inscription/désinscription, voir registerForTournamentAction/
-- unregisterFromTournamentAction).
INSERT INTO "UserLifetimeStats" ("userId", "tournamentsParticipatedCount")
SELECT "userId", COUNT(*)::int
FROM "TournamentParticipant"
GROUP BY "userId"
ON CONFLICT ("userId") DO NOTHING;
