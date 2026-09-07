import { prisma } from "@/lib/prisma";
import { formatDateTimeFr } from "@/lib/wallclock";
import { createNotifications } from "@/lib/notifications";
import type { Debt } from "@prisma/client";

/**
 * Détecte les dettes de gage (Sprint 3 suite) — appelée depuis
 * `submitSessionResultsAction` juste après la saisie des résultats : un
 * voteur de la proposition gagnante qui n'a PAS été coché "présent" dans
 * le formulaire de résultats devient débiteur. `reason` fige le contexte
 * (jeu + date) au moment de la détection — la session peut être modifiée
 * ou supprimée après coup sans que la dette perde son sens.
 *
 * Pas de garde d'idempotence ici : `submitSessionResultsAction` appelle
 * cette fonction une seule fois par session (même garde
 * `alreadySubmitted` que pour `SessionResult`), donc pas de risque de
 * double dette pour la même absence.
 */
export async function detectDebts(
  sessionId: string,
  absentUserIds: string[],
  gameName: string,
  sessionDate: Date
): Promise<void> {
  if (absentUserIds.length === 0) return;

  const reason = `A voté pour ${gameName} (soirée du ${formatDateTimeFr(sessionDate)}) mais n'est pas venu.`;
  await prisma.debt.createMany({
    data: absentUserIds.map((debtorId) => ({ debtorId, sessionId, reason })),
  });

  // Notification in-app (Amélioration des features existantes, PR-B, item
  // 4) — jusqu'ici `detectDebts` ne créait aucune notif, l'unique moyen de
  // découvrir une dette était de tomber dessus sur la Home.
  await createNotifications(
    absentUserIds.map((debtorId) => ({
      userId: debtorId,
      type: "DEBT" as const,
      title: "💀 Nouveau gage",
      message: `Tu as voté pour ${gameName} mais tu n'es pas venu — un gage t'attend.`,
      relatedSessionId: sessionId,
    }))
  );
}

export interface ActiveDebt extends Debt {
  debtor: { id: string; discordName: string; discordAvatar: string | null };
  session: { date: Date; createdById: string; decidedGame: { name: string } | null };
}

/** "Dettes du groupe" sur la Home — dettes non soldées (`paidAt` nul), les plus récentes d'abord. */
export async function getActiveDebts(): Promise<ActiveDebt[]> {
  return prisma.debt.findMany({
    where: { paidAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      debtor: { select: { id: true, discordName: true, discordAvatar: true } },
      session: { select: { date: true, createdById: true, decidedGame: { select: { name: true } } } },
    },
  });
}

/** Ids des débiteurs actifs — badge "💀" sur le pseudo (Home, /potes). */
export async function getActiveDebtorIds(): Promise<Set<string>> {
  const debts = await prisma.debt.findMany({
    where: { paidAt: null },
    select: { debtorId: true },
    distinct: ["debtorId"],
  });
  return new Set(debts.map((d) => d.debtorId));
}
