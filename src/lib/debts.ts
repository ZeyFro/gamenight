import { getActiveScopedPrisma, getScopedPrisma, scopedPrismaForCommunity, withCommunity } from "@/lib/community-scoped-client";
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
 *
 * Multi-communautés (PR8) : une dette hérite de la communauté de sa soirée
 * (`sessionCommunityId`, `null` = communauté par défaut), quel que soit
 * l'état d'appartenance du créateur au moment de la saisie.
 */
export async function detectDebts(
  sessionId: string,
  absentUserIds: string[],
  gameName: string,
  sessionDate: Date,
  sessionCommunityId: string | null
): Promise<void> {
  if (absentUserIds.length === 0) return;

  const reason = `A voté pour ${gameName} (soirée du ${formatDateTimeFr(sessionDate)}) mais n'est pas venu.`;
  const scopedDb = scopedPrismaForCommunity(sessionCommunityId);
  await scopedDb.debt.createMany({
    data: absentUserIds.map((debtorId) => ({ debtorId, sessionId, reason, ...withCommunity(sessionCommunityId) })),
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

/**
 * "Dettes du groupe" sur la Home — dettes non soldées (`paidAt` nul), les plus
 * récentes d'abord. Multi-communautés (PR8) : celles de la communauté active de `viewerId`.
 */
export async function getActiveDebts(viewerId: string): Promise<ActiveDebt[]> {
  const scopedDb = await getActiveScopedPrisma(viewerId);
  return scopedDb.debt.findMany({
    where: { paidAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      debtor: { select: { id: true, discordName: true, discordAvatar: true } },
      session: { select: { date: true, createdById: true, decidedGame: { select: { name: true } } } },
    },
  });
}

/**
 * Ids des débiteurs actifs — badge "💀" sur le pseudo (Home, /potes). Périmètre :
 * toutes les communautés de `viewerId` (le badge suit la personne, pas un serveur).
 */
export async function getActiveDebtorIds(viewerId: string): Promise<Set<string>> {
  const scopedDb = await getScopedPrisma(viewerId);
  const debts = await scopedDb.debt.findMany({
    where: { paidAt: null },
    select: { debtorId: true },
    distinct: ["debtorId"],
  });
  return new Set(debts.map((d) => d.debtorId));
}
