-- Chantier nettoyage réel du stockage (V2, suite — closes #107) : les
-- stats de GROUPE de la Home ("total de soirées jouées" / "jeu le plus
-- joué") comptaient jusqu'ici des lignes `Session` DONE en direct
-- (`Session.count`/`Session.groupBy`), désormais purgeables 7 jours après
-- leur fin. Cette migration crée un résumé durable MINIMAL (deux
-- compteurs, jamais une copie des soirées) et le BACKFILL immédiatement
-- avec les soirées DONE déjà existantes — AVANT que la moindre purge ne
-- puisse jamais en supprimer une (même raisonnement que le backfill
-- `UserLifetimeStats` de la migration précédente).

CREATE TABLE "GroupSessionStats" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "totalSessionsPlayed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GroupSessionStats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupGameStat" (
    "gameId" TEXT NOT NULL,
    "playCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GroupGameStat_pkey" PRIMARY KEY ("gameId")
);

ALTER TABLE "GroupGameStat"
  ADD CONSTRAINT "GroupGameStat_gameId_fkey"
  FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill — une seule fois, ici, jamais recalculé après coup (le
-- compteur avance ensuite exclusivement par incrément explicite au
-- moment SCHEDULED → DONE, voir `markSessionDone`, src/lib/sessions.ts).
-- Toutes les soirées DONE existent ENCORE à cet instant (cette migration
-- s'exécute avant tout déploiement du code de purge), donc ce compte est
-- exact au moment de la migration.
-- `COUNT(*)` sans `GROUP BY` retourne toujours exactement une ligne
-- (0 si aucune soirée DONE n'existe encore) — la ligne singleton existe
-- donc toujours après cet INSERT, jamais un `findUnique` qui échoue au
-- premier appel applicatif.
INSERT INTO "GroupSessionStats" ("id", "totalSessionsPlayed")
SELECT 'global', COUNT(*)::int
FROM "Session"
WHERE "status" = 'DONE';

INSERT INTO "GroupGameStat" ("gameId", "playCount")
SELECT "decidedGameId", COUNT(*)::int
FROM "Session"
WHERE "status" = 'DONE' AND "decidedGameId" IS NOT NULL
GROUP BY "decidedGameId";
