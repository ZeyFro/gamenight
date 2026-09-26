-- V2 — "Jouer maintenant" : sessions spontanées, distinctes des soirées
-- planifiées et de la roulette instantanée. Voir le commentaire de
-- modèle dans schema.prisma pour le détail des garanties.

CREATE TYPE "InstantSessionStatus" AS ENUM ('ACTIVE', 'ENDED');

CREATE TABLE "InstantSession" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "status" "InstantSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endedReason" TEXT,
    "notifiedUserIds" JSONB,

    CONSTRAINT "InstantSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstantSession_status_expiresAt_idx" ON "InstantSession"("status", "expiresAt");

ALTER TABLE "InstantSession" ADD CONSTRAINT "InstantSession_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InstantSession" ADD CONSTRAINT "InstantSession_gameId_fkey"
    FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InstantSessionPresenceInterval" (
    "id" TEXT NOT NULL,
    "instantSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "InstantSessionPresenceInterval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstantSessionPresenceInterval_instantSessionId_userId_idx" ON "InstantSessionPresenceInterval"("instantSessionId", "userId");
CREATE INDEX "InstantSessionPresenceInterval_instantSessionId_endedAt_idx" ON "InstantSessionPresenceInterval"("instantSessionId", "endedAt");

-- Garantie DB — au plus UN intervalle OUVERT (`endedAt IS NULL`) par
-- utilisateur, TOUS ensembles/sessions confondus : "un utilisateur ne
-- peut être membre que d'une seule session instantanée active à la
-- fois". Un index unique PARTIEL n'est pas représentable directement
-- dans le schema Prisma (limite connue) — documenté ici ET dans le
-- commentaire de modèle `InstantSessionPresenceInterval` (schema.prisma),
-- même convention que les dérives déjà assumées et documentées dans le
-- README. C'est CETTE contrainte, pas une vérification applicative
-- seule, qui protège contre deux créations/jonctions concurrentes pour
-- le même utilisateur : une seconde tentative concurrente échoue avec
-- une violation de contrainte unique, interceptée côté application
-- (`src/lib/instant-sessions.ts`) et traduite en refus propre, jamais une
-- exception non gérée.
CREATE UNIQUE INDEX "InstantSessionPresenceInterval_userId_open_key"
    ON "InstantSessionPresenceInterval"("userId")
    WHERE "endedAt" IS NULL;

ALTER TABLE "InstantSessionPresenceInterval" ADD CONSTRAINT "InstantSessionPresenceInterval_instantSessionId_fkey"
    FOREIGN KEY ("instantSessionId") REFERENCES "InstantSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InstantSessionPresenceInterval" ADD CONSTRAINT "InstantSessionPresenceInterval_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
