import { prisma } from "@/lib/prisma";
import { getCalendarData } from "@/lib/calendar";
import { addDays, buildCalendarHref, getWeekStart } from "@/lib/calendar-dates";
import { todayDateOnly, DAY_LABELS_MON_FIRST } from "@/lib/wallclock";

/**
 * Données agrégées pour la home (refonte : "Activité récente", "Stats du
 * groupe", "Dispos de la semaine"). Regroupées ici plutôt que dans les
 * fichiers existants (`calendar.ts`, `scoreboard.ts`, `badges.ts`…) : ces
 * trois fonctions n'ont d'autre consommateur que `/` — même logique que
 * `scoreboard.ts` dédié à `/classement`.
 */

export interface ActivityItem {
  id: string;
  icon: string;
  text: string;
  timestamp: Date;
}

/**
 * Feed "Activité récente" : fusionne 4 types d'événements déjà horodatés
 * en base (soirées terminées, badges débloqués, récompenses superlatives,
 * passages de niveau) et retourne les `limit` plus récents tous types
 * confondus. Pas de pagination (demandé) : on ne récupère que `limit`
 * lignes de CHAQUE type puis on tronque après fusion — largement
 * suffisant, `limit` reste petit (5) et aucun type ne peut à lui seul
 * dominer les 5 lignes si un autre type est plus récent.
 *
 * "Soirée jouée" n'a pas de pseudo naturel (événement de groupe) — on
 * utilise le créateur de la session pour rester cohérent avec le format
 * "icône + pseudo + texte" des 3 autres types. L'horodatage de tri est
 * `session.date` (pas de colonne "marquée DONE le") : cohérent, une
 * session DONE a par construction déjà eu lieu (clôture manuelle ou
 * automatique 6h après le début, cf. PR fix cycle de vie).
 */
export async function getRecentActivity(limit = 5): Promise<ActivityItem[]> {
  const [playedSessions, badgeUnlocks, superlativeAwards, levelUps] = await Promise.all([
    prisma.session.findMany({
      where: { status: "DONE" },
      orderBy: { date: "desc" },
      take: limit,
      select: {
        id: true,
        date: true,
        decidedGame: { select: { name: true } },
        createdBy: { select: { discordName: true } },
      },
    }),
    prisma.userBadge.findMany({
      orderBy: { unlockedAt: "desc" },
      take: limit,
      select: {
        id: true,
        unlockedAt: true,
        user: { select: { discordName: true } },
        badge: { select: { name: true, icon: true } },
      },
    }),
    prisma.superlativeAward.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        winner: { select: { discordName: true } },
        category: { select: { name: true, icon: true } },
      },
    }),
    prisma.levelUpEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        level: true,
        createdAt: true,
        user: { select: { discordName: true } },
      },
    }),
  ]);

  const items: ActivityItem[] = [
    ...playedSessions.map((s) => ({
      id: `session-${s.id}`,
      icon: "🎮",
      text: `Soirée ${s.decidedGame?.name ?? "?"} terminée (par ${s.createdBy.discordName})`,
      timestamp: s.date,
    })),
    ...badgeUnlocks.map((b) => ({
      id: `badge-${b.id}`,
      icon: b.badge.icon,
      text: `${b.user.discordName} a débloqué le badge ${b.badge.name}`,
      timestamp: b.unlockedAt,
    })),
    ...superlativeAwards.map((a) => ({
      id: `award-${a.id}`,
      icon: a.category.icon,
      text: `${a.winner.discordName} a gagné ${a.category.name}`,
      timestamp: a.createdAt,
    })),
    ...levelUps.map((l) => ({
      id: `levelup-${l.id}`,
      icon: "🎉",
      text: `${l.user.discordName} est passé niveau ${l.level}`,
      timestamp: l.createdAt,
    })),
  ];

  items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return items.slice(0, limit);
}

export interface GroupStats {
  totalSessionsPlayed: number;
  mostPlayedGame: { name: string; coverUrl: string | null; count: number } | null;
  bestActiveStreak: { discordName: string; streakCount: number } | null;
  activePlayers: number;
}

const ACTIVE_STREAK_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACTIVE_PLAYER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * "Actif" a deux définitions distinctes ici, assumées : un streak
 * "toujours actif" suit exactement la fenêtre de cassure de
 * `touchStreak` (24h, xp-actions.ts) — au-delà, le streak lui-même serait
 * déjà retombé à 1 au prochain passage. Un "joueur actif" pour le
 * compteur de groupe est une fenêtre plus large (7 jours) — un pote qui
 * n'a pas ouvert l'app depuis 2 jours n'a pas "disparu" du groupe, il n'a
 * juste pas de streak en cours.
 */
export async function getGroupStats(): Promise<GroupStats> {
  const now = Date.now();

  const [totalSessionsPlayed, gameGroups, bestStreakUser, activePlayers] = await Promise.all([
    prisma.session.count({ where: { status: "DONE" } }),
    prisma.session.groupBy({
      by: ["decidedGameId"],
      where: { status: "DONE", decidedGameId: { not: null } },
      _count: { _all: true },
    }),
    prisma.user.findFirst({
      where: {
        streakCount: { gt: 0 },
        streakLastActiveAt: { gte: new Date(now - ACTIVE_STREAK_WINDOW_MS) },
      },
      orderBy: { streakCount: "desc" },
      select: { discordName: true, streakCount: true },
    }),
    prisma.user.count({
      where: { streakLastActiveAt: { gte: new Date(now - ACTIVE_PLAYER_WINDOW_MS) } },
    }),
  ]);

  let mostPlayedGame: GroupStats["mostPlayedGame"] = null;
  const topGroup = gameGroups.reduce<(typeof gameGroups)[number] | null>(
    (best, g) => (!best || g._count._all > best._count._all ? g : best),
    null
  );
  if (topGroup?.decidedGameId) {
    const game = await prisma.game.findUnique({
      where: { id: topGroup.decidedGameId },
      select: { name: true, coverUrl: true },
    });
    if (game) {
      mostPlayedGame = { name: game.name, coverUrl: game.coverUrl, count: topGroup._count._all };
    }
  }

  return {
    totalSessionsPlayed,
    mostPlayedGame,
    bestActiveStreak: bestStreakUser
      ? { discordName: bestStreakUser.discordName, streakCount: bestStreakUser.streakCount }
      : null,
    activePlayers,
  };
}

export interface GameNewsItem {
  id: string;
  gameName: string;
  gameCoverUrl: string | null;
  title: string;
  url: string;
  publishedAt: Date;
}

const RECENT_NEWS_COUNT = 5;

/**
 * Card "Actu gaming" (Sprint 3) — lit uniquement le cache `GameNews`,
 * jamais l'API Steam elle-même (rafraîchi à part par
 * `runGameNewsBackfill`, cf. ce fichier). Comme le backfill ne peuple
 * JAMAIS cette table pour un jeu hors du top 10 le plus joué au moment où
 * il tourne, un simple tri par `publishedAt` desc sur toute la table
 * suffit à retrouver "les news des jeux les plus joués" sans reference
 * séparée au classement — pas besoin de refiltrer par jeu ici.
 */
export async function getRecentGameNews(limit = RECENT_NEWS_COUNT): Promise<GameNewsItem[]> {
  const news = await prisma.gameNews.findMany({
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      url: true,
      publishedAt: true,
      game: { select: { name: true, coverUrl: true } },
    },
  });

  return news.map((n) => ({
    id: n.id,
    gameName: n.game.name,
    gameCoverUrl: n.game.coverUrl,
    title: n.title,
    url: n.url,
    publishedAt: n.publishedAt,
  }));
}

export interface WeekAvailabilityDay {
  date: Date;
  label: string;
  availableCount: number;
  totalUsers: number;
  href: string;
  isBest: boolean;
}

/** Heure "du soir" représentative pour le mini-aperçu de la semaine — même convention que `AUTO_SCROLL_HOUR` dans `DayTimeline`. */
const EVENING_HOUR = 20;

/**
 * "Dispos de la semaine" : semaine calendaire (lundi→dimanche) contenant
 * aujourd'hui — pas un rolling 7 jours depuis aujourd'hui — cohérent avec
 * les colonnes "Lun→Dim" demandées et avec `DAY_LABELS_MON_FIRST` déjà
 * utilisé ailleurs (dispos hebdo). Les jours déjà passés cette semaine
 * restent affichés (qui était dispo), simplement non mis en avant comme
 * "meilleur jour" s'ils sont dans le passé n'a pas d'importance : le tap
 * renvoie vers `/calendrier?date=...`, qui reste consultable même pour
 * une date passée.
 */
export async function getWeekAvailability(): Promise<WeekAvailabilityDay[]> {
  const weekStart = getWeekStart(todayDateOnly());
  const weekEndExclusive = addDays(weekStart, 7);
  const data = await getCalendarData(weekStart, weekEndExclusive);
  const totalUsers = data.users.length;

  const days = data.days.map((day) => {
    const hourData = day.hours.find((h) => h.hour === EVENING_HOUR);
    const availableCount = hourData?.availableUserIds.length ?? 0;
    const dayOfWeek = day.date.getUTCDay();
    const label = DAY_LABELS_MON_FIRST.find((d) => d.dayOfWeek === dayOfWeek)?.label ?? "";
    return {
      date: day.date,
      label,
      availableCount,
      totalUsers,
      href: buildCalendarHref({ date: day.date.toISOString().slice(0, 10), mode: "collectif" }),
      isBest: false,
    };
  });

  const maxCount = Math.max(0, ...days.map((d) => d.availableCount));
  if (maxCount > 0) {
    const bestIndex = days.findIndex((d) => d.availableCount === maxCount);
    if (bestIndex !== -1) days[bestIndex].isBest = true;
  }

  return days;
}
