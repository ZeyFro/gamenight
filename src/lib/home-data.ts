import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nowMs, wallClockNow } from "@/lib/wallclock";
import { getRecentActivity, getGroupStats, getWeekAvailability, getRecentGameNews } from "@/lib/home";
import { getScoreboard } from "@/lib/scoreboard";
import { levelForXp, rankForLevel, titleForLevel } from "@/lib/xp";
import { getCurrentWeeklyChallenge } from "@/lib/weekly-challenges";
import { getActiveDebts, getActiveDebtorIds } from "@/lib/debts";
import { getMonthlyRecap } from "@/lib/monthly-recap";
import { accessibleSessionWhere } from "@/lib/session-access";
import { ensureActiveSeasonExists, getSeasonProgress } from "@/lib/seasons";
import { getActiveTournament } from "@/lib/tournaments";

/**
 * Données de l'accueil v2 (`/accueil-v2`) : mêmes requêtes que l'accueil
 * actuel (`src/app/page.tsx`, branche « connecté »), dans le même ordre et avec
 * les mêmes filtres de confidentialité (`accessibleSessionWhere`). Aucune
 * donnée fictive.
 *
 * Volontairement absents (effets de bord de l'accueil actuel, pas des données
 * affichées) : la clôture automatique d'une soirée au vote échu
 * (`closeSessionIfDue`) et l'affichage de l'onboarding. Cette page ne les
 * déclenche donc pas ; `/` continue de s'en charger.
 */
export async function loadHomeData(user: User) {
  // Garde-fou idempotent identique à `/` (voir `ensureActiveSeasonExists`).
  await ensureActiveSeasonExists();

  const [
    nextSession,
    activity,
    groupStats,
    weekAvailability,
    scoreboard,
    gameNews,
    weeklyChallenge,
    groupAchievements,
    activeDebts,
    activeDebtorIds,
  ] = await Promise.all([
    prisma.session.findFirst({
      where: { status: { in: ["VOTING", "SCHEDULED"] }, ...accessibleSessionWhere(user.id) },
      orderBy: { date: "asc" },
      include: {
        decidedGame: { select: { name: true, coverUrl: true } },
        proposals: {
          select: {
            gameId: true,
            game: { select: { coverUrl: true } },
            votes: { select: { userId: true } },
          },
        },
      },
    }),
    getRecentActivity(user.id, 3),
    getGroupStats(),
    getWeekAvailability(user.id),
    getScoreboard("global"),
    getRecentGameNews(),
    getCurrentWeeklyChallenge(),
    prisma.groupAchievement.findMany({ orderBy: [{ unlockedAt: "desc" }, { createdAt: "asc" }] }),
    getActiveDebts(),
    getActiveDebtorIds(),
  ]);

  const wallNow = wallClockNow();
  const prevMonthDate = new Date(Date.UTC(wallNow.getUTCFullYear(), wallNow.getUTCMonth() - 1, 1));
  const recapYear = prevMonthDate.getUTCFullYear();
  const recapMonth = prevMonthDate.getUTCMonth() + 1;
  const [lastMonthRecap, seasonProgress, activeTournament] = await Promise.all([
    getMonthlyRecap(recapYear, recapMonth),
    getSeasonProgress(),
    getActiveTournament(),
  ]);

  // Cover : jeu décidé si la soirée est SCHEDULED, sinon proposition la plus votée.
  const topProposal = nextSession?.proposals.reduce<(typeof nextSession.proposals)[number] | null>(
    (best, p) => (!best || p.votes.length > best.votes.length ? p : best),
    null
  );
  const nextSessionCoverUrl = nextSession?.decidedGame?.coverUrl ?? topProposal?.game.coverUrl ?? null;

  // « Joueurs inscrits » : voteurs de la proposition gagnante une fois le jeu
  // décidé, sinon voteurs de toutes les propositions.
  const registeredPlayerIds = new Set<string>();
  if (nextSession) {
    const relevantProposals = nextSession.decidedGameId
      ? nextSession.proposals.filter((p) => p.gameId === nextSession.decidedGameId)
      : nextSession.proposals;
    for (const p of relevantProposals) {
      for (const v of p.votes) registeredPlayerIds.add(v.userId);
    }
  }

  const level = levelForXp(user.xpTotal);

  return {
    now: nowMs(),
    nextSession,
    nextSessionCoverUrl,
    registeredPlayerCount: registeredPlayerIds.size,
    activity,
    groupStats,
    weekAvailability,
    scoreboard,
    gameNews,
    weeklyChallenge,
    groupAchievements,
    activeDebts,
    activeDebtorIds,
    lastMonthRecap,
    recapYear,
    recapMonth,
    seasonProgress,
    activeTournament,
    level,
    rank: rankForLevel(level),
    title: titleForLevel(level),
  };
}
