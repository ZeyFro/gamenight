-- Chantier nettoyage réel du stockage (V2, suite — closes #107) : le
-- trophée de groupe "Réguliers" (4 semaines calendaires CONSÉCUTIVES avec
-- au moins une soirée DONE, `checkGroupAchievements`,
-- src/lib/group-achievements.ts) recalculait jusqu'ici ses semaines à
-- partir des soirées `Session` DONE ENCORE VIVANTES au moment du check —
-- désormais purgeables 7 jours après leur fin. Cette migration crée un
-- résumé durable MINIMAL (une ligne PAR SEMAINE ayant eu ≥1 soirée DONE,
-- jamais une ligne par soirée) et le BACKFILLE immédiatement avec les
-- semaines déjà représentées par les soirées DONE existantes — AVANT que
-- la moindre purge ne puisse jamais en supprimer une.

CREATE TABLE "GroupActiveWeek" (
    "weekStart" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupActiveWeek_pkey" PRIMARY KEY ("weekStart")
);

-- Lundi 00:00 de la semaine calendaire de "date", calculé SANS conversion
-- de fuseau horaire (la colonne "date" est un `timestamp without time
-- zone` déjà traité comme UTC partout ailleurs dans ce schéma) — même
-- calcul que `getWeekStart` (src/lib/calendar-dates.ts) : jour de la
-- semaine ISO (1 = lundi .. 7 = dimanche), on retranche (jour - 1) jours
-- à la date tronquée.
INSERT INTO "GroupActiveWeek" ("weekStart")
SELECT DISTINCT (("date"::date - (EXTRACT(ISODOW FROM "date")::int - 1)))::timestamp(3)
FROM "Session"
WHERE "status" = 'DONE';
