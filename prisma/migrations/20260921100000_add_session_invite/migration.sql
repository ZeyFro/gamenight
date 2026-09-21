-- Chantier confidentialité des soirées — remplace l'ancien choix
-- d'annonces collectives. `SessionInvite` devient la source de vérité
-- persistante du contrôle d'accès (créateur + invités actifs uniquement),
-- jamais `Session.notifiedUserIds` (qui reste un simple filtre de
-- mentions Discord, voir son commentaire dans schema.prisma).
CREATE TYPE "SessionInviteStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "SessionInvite" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "status" "SessionInviteStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "SessionInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionInvite_sessionId_userId_key" ON "SessionInvite"("sessionId", "userId");
CREATE INDEX "SessionInvite_sessionId_status_idx" ON "SessionInvite"("sessionId", "status");
CREATE INDEX "SessionInvite_userId_status_idx" ON "SessionInvite"("userId", "status");

ALTER TABLE "SessionInvite" ADD CONSTRAINT "SessionInvite_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionInvite" ADD CONSTRAINT "SessionInvite_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionInvite" ADD CONSTRAINT "SessionInvite_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SessionInvite" ADD CONSTRAINT "SessionInvite_revokedById_fkey"
    FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill des soirées EXISTANTES — reprend l'ensemble `notifiedUserIds`
-- quand il a été explicitement posé par le créateur (même vide), SEULE
-- source fiable disponible d'une intention d'invitation : jamais déduite
-- d'un vote, d'une proposition, d'une mention ou d'une présence (chacune
-- de ces sources aurait pu inclure des gens jamais réellement invités —
-- un pote qui a voté par curiosité sur une soirée ouverte à tous, avant
-- ce chantier, n'a jamais été "invité" au sens de la nouvelle règle).
--
-- `notifiedUserIds IS NULL` (soirées créées avant l'introduction du ping
-- sélectif, PR "notifiedUserIds") : aucune source fiable — accès créateur
-- SEUL, aucun invité backfillé. Réinvitation possible depuis l'interface
-- de gestion des invités (src/app/sessions/actions/invites.ts), jamais
-- automatique.
--
-- Le créateur lui-même n'a jamais besoin d'une ligne `SessionInvite` (il
-- garde toujours accès via `Session.createdById`, voir
-- `src/lib/session-access.ts`) — explicitement exclu du backfill ci-dessous
-- même s'il apparaissait dans son propre `notifiedUserIds`.
INSERT INTO "SessionInvite" ("id", "sessionId", "userId", "invitedById", "status", "createdAt")
SELECT
    'sinv_' || replace(gen_random_uuid()::text, '-', ''),
    s."id",
    u.value,
    s."createdById",
    'ACTIVE',
    s."createdAt"
FROM "Session" s
CROSS JOIN LATERAL jsonb_array_elements_text(s."notifiedUserIds") AS u(value)
WHERE s."notifiedUserIds" IS NOT NULL
  AND u.value <> s."createdById"
  AND EXISTS (SELECT 1 FROM "User" WHERE "id" = u.value);
