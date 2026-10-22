import { getActiveScopedPrisma, scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { listCronCommunityIds } from "@/lib/community-isolation";
import { isUniqueConstraintViolation } from "@/lib/xp-actions";
import { wallClockNow, startOfMonthUTC, endOfMonthUTC } from "@/lib/wallclock";
import { ACCENT_COLOR } from "@/lib/discord";
import { postToCommunity } from "@/lib/community-announce";
import { logger } from "@/lib/logger";

export interface MonthlyRecapData {
  sessionsPlayed: number;
  mostPlayedGame: { name: string; count: number } | null;
  mvpOfMonth: { discordName: string; count: number } | null;
  mostActive: { discordName: string; count: number } | null;
  bestStreak: { discordName: string; streak: number } | null;
  bestPronostiqueur: { discordName: string; count: number } | null;
  totalGroupXp: number;
}

function topEntry<T>(
  counts: Map<string, number>,
  labelFor: (id: string) => T
): { id: string; count: number; label: T } | null {
  let bestId: string | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      bestId = id;
      bestCount = count;
    }
  }
  return bestId ? { id: bestId, count: bestCount, label: labelFor(bestId) } : null;
}

/**
 * Sprint 4 (FEATURE 2, Recap mensuel Wrapped) — calcule les stats du mois
 * `year`/`month` (1-12). Toutes les requêtes sont bornées à
 * `[startOfMonthUTC, endOfMonthUTC]` de ce mois — un recap est un
 * instantané figé du mois concerné, jamais recalculé après coup (cf.
 * `MonthlyRecap.@@unique([communityId, year, month])`).
 */
async function computeMonthlyRecapData(year: number, month: number, communityId: string): Promise<MonthlyRecapData> {
  const start = startOfMonthUTC(new Date(Date.UTC(year, month - 1, 1)));
  const end = endOfMonthUTC(start);
  const scopedDb = await scopedPrismaForCommunityId(communityId);

  const [doneSessions, participateEvents, xpSum, correctPronostics, allUsers] =
    await Promise.all([
      scopedDb.session.findMany({
        where: { status: "DONE", date: { gte: start, lte: end } },
        include: { decidedGame: true },
      }),
      scopedDb.xpEvent.findMany({
        where: { communityId, reason: "PARTICIPATE", createdAt: { gte: start, lte: end } },
        include: { user: true },
      }),
      scopedDb.xpEvent.aggregate({
        where: { communityId, createdAt: { gte: start, lte: end }, reason: { not: "SHOP_BALANCE_PURCHASE" } },
        _sum: { amount: true },
      }),
      scopedDb.pronostic.findMany({
        where: { correct: true, createdAt: { gte: start, lte: end } },
        include: { voter: true },
      }),
      scopedDb.communityMemberStats.findMany({
        where: { communityId, user: { memberships: { some: { communityId, status: "ACTIVE", community: { status: "ACTIVE" } } } } },
        select: { user: { select: { discordName: true } }, streakCount: true },
        orderBy: { streakCount: "desc" },
        take: 1,
      }),
    ]);

  const gameCounts = new Map<string, number>();
  const gameNames = new Map<string, string>();
  for (const session of doneSessions) {
    if (!session.decidedGameId || !session.decidedGame) continue;
    gameCounts.set(session.decidedGameId, (gameCounts.get(session.decidedGameId) ?? 0) + 1);
    gameNames.set(session.decidedGameId, session.decidedGame.name);
  }
  const topGame = topEntry(gameCounts, (id) => gameNames.get(id)!);

  const mvpCategoryAwards = await scopedDb.superlativeAward.findMany({
    where: {
      createdAt: { gte: start, lte: end },
      category: { name: { contains: "MVP", mode: "insensitive" } },
    },
    include: { winner: true },
  });
  const mvpCounts = new Map<string, number>();
  const mvpNames = new Map<string, string>();
  for (const award of mvpCategoryAwards) {
    mvpCounts.set(award.winnerUserId, (mvpCounts.get(award.winnerUserId) ?? 0) + 1);
    mvpNames.set(award.winnerUserId, award.winner.discordName);
  }
  const topMvp = topEntry(mvpCounts, (id) => mvpNames.get(id)!);

  const activeCounts = new Map<string, number>();
  const activeNames = new Map<string, string>();
  for (const event of participateEvents) {
    activeCounts.set(event.userId, (activeCounts.get(event.userId) ?? 0) + 1);
    activeNames.set(event.userId, event.user.discordName);
  }
  const topActive = topEntry(activeCounts, (id) => activeNames.get(id)!);

  const pronosticCounts = new Map<string, number>();
  const pronosticNames = new Map<string, string>();
  for (const pronostic of correctPronostics) {
    pronosticCounts.set(pronostic.voterId, (pronosticCounts.get(pronostic.voterId) ?? 0) + 1);
    pronosticNames.set(pronostic.voterId, pronostic.voter.discordName);
  }
  const topPronostiqueur = topEntry(pronosticCounts, (id) => pronosticNames.get(id)!);

  const bestStreakUser = allUsers[0];

  return {
    sessionsPlayed: doneSessions.length,
    mostPlayedGame: topGame ? { name: topGame.label, count: topGame.count } : null,
    mvpOfMonth: topMvp ? { discordName: topMvp.label, count: topMvp.count } : null,
    mostActive: topActive ? { discordName: topActive.label, count: topActive.count } : null,
    bestStreak:
      bestStreakUser && bestStreakUser.streakCount > 0
        ? { discordName: bestStreakUser.user.discordName, streak: bestStreakUser.streakCount }
        : null,
    bestPronostiqueur: topPronostiqueur
      ? { discordName: topPronostiqueur.label, count: topPronostiqueur.count }
      : null,
    totalGroupXp: xpSum._sum.amount ?? 0,
  };
}

/**
 * Génère le recap du mois précédent au premier passage du cron
 * `monthly-tasks` à partir du 1er du mois (`wallClockNow().getUTCDate()
 * === 1`) — idempotent via `@@unique([year, month])` sur `MonthlyRecap`,
 * un second appel le même mois (ou un jour après le 1er, si le cron a
 * loupé une exécution) ne recrée rien.
 */
export async function generateMonthlyRecapIfDue(): Promise<void> {
  const now = wallClockNow();
  if (now.getUTCDate() !== 1) return;

  const prevMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const year = prevMonthDate.getUTCFullYear();
  const month = prevMonthDate.getUTCMonth() + 1;

  for (const communityId of await listCronCommunityIds()) {
    await generateMonthlyRecapForCommunity(communityId, year, month);
  }
}

async function generateMonthlyRecapForCommunity(communityId: string, year: number, month: number): Promise<void> {
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  const existing = await scopedDb.monthlyRecap.findUnique({
    where: { communityId_year_month: { communityId, year, month } },
  });
  if (existing) return;

  const data = await computeMonthlyRecapData(year, month, communityId);
  // Rien à raconter (aucune soirée jouée) : pas de recap vide, pas de notif.
  if (data.sessionsPlayed === 0) return;

  try {
    await scopedDb.monthlyRecap.create({
      data: { communityId, year, month, data: data as unknown as object },
    });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    return; // Un autre cron a créé le snapshot : aucune seconde annonce.
  }

  const base = (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const result = await postToCommunity(communityId, {
    title: "📊 Le recap du mois est prêt !",
    description: `${data.sessionsPlayed} soirée${data.sessionsPlayed > 1 ? "s" : ""} jouée${data.sessionsPlayed > 1 ? "s" : ""} le mois dernier — va voir ton Wrapped !\n${base}/recap/${year}/${month}`,
    color: ACCENT_COLOR,
  });
  if (!result.ok) {
    logger.warn("monthly-recap", "Notif Discord recap prêt non envoyée.", { year, month });
  }
}

/** Lecture typée d'un recap déjà généré — `/recap/[year]/[month]` et la card Home. */
export async function getMonthlyRecap(
  year: number,
  month: number,
  viewerId: string
): Promise<MonthlyRecapData | null> {
  const scopedDb = await getActiveScopedPrisma(viewerId);
  const recap = await scopedDb.monthlyRecap.findFirst({ where: { year, month } });
  return recap ? (recap.data as unknown as MonthlyRecapData) : null;
}
