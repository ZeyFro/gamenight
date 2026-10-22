import { prisma } from "@/lib/prisma";
import { getDefaultCommunityId } from "@/lib/default-community";
import { scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { levelForXp, rankForLevel, titleForLevel, xpForLevel, type Rank } from "@/lib/xp";

const WEEK_DELTA_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_STREAK_WINDOW_MS = 24 * 60 * 60 * 1000;

export const SCOREBOARD_PERIODS = ["global", "month", "week"] as const;
export type ScoreboardPeriod = (typeof SCOREBOARD_PERIODS)[number];

export interface FunLeaderboards {
  gamesByPlayTime: { gameId: string; name: string; coverUrl: string | null; totalPlayMinutes: number }[];
  gamesByPlayCount: { gameId: string; name: string; playCount: number }[];
  playersByStreak: { userId: string; discordName: string; discordAvatar: string | null; color: string; streakCount: number }[];
}

export interface ScoreboardEntry {
  userId: string;
  discordName: string;
  discordAvatar: string | null;
  color: string;
  level: number;
  rank: Rank;
  title: string;
  periodXp: number;
  sessionsPlayed: number;
  /**
   * Amélioration classement — delta de position par rapport à il y a 7
   * jours (positif = a gagné des places, négatif = en a perdu, `0` =
   * stable). `null` pour les périodes "Ce mois"/"Cette semaine" (un
   * delta de position n'a de sens que sur un classement global stable,
   * pas sur une fenêtre qui se réinitialise) — voir `weekDeltaPositions`.
   */
  weekDeltaPosition: number | null;
  /** XP dans le niveau courant / XP requis pour le niveau suivant (0-1). */
  levelProgress: number;
}

/**
 * Début de la période pour "Ce mois"/"Cette semaine" — `null` pour
 * "Global" (progression `CommunityMemberStats.xpTotal` du serveur). Semaine
 * calée sur lundi (même convention que `DAY_LABELS_MON_FIRST` dans
 * wallclock.ts, cohérent avec le planning de dispos).
 */
function periodStart(period: ScoreboardPeriod): Date | null {
  if (period === "global") return null;

  const now = new Date();
  if (period === "week") {
    const dayOfWeek = now.getUTCDay(); // 0 = dimanche
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday)
    );
  }

  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Classement du groupe (`/classement`, PR 9/9 — dernière étape du
 * chantier XP). Toujours **tous** les users (même à 0 XP sur la période
 * choisie), triés par XP décroissant. Niveau/rang/titre restent calculés
 * sur `xpTotal` courant de la saison (`levelForXp`) **quelle que soit la période
 * affichée** : un "niveau" hebdomadaire n'a pas de sens (le niveau est un
 * jalon cumulatif), seul le classement (position + XP affiché) change
 * selon le filtre — décision assumée, pas explicitement demandée mais
 * cohérente avec le reste du chantier XP (niveaux/rangs toujours globaux,
 * ex. `RankAvatar` sur `/profil` et `/potes/[id]`).
 *
 * "Soirées jouées" est en revanche filtré par la même période que l'XP
 * (nombre de `XpEvent` PARTICIPATE dans la fenêtre) plutôt que laissé en
 * cumul à vie sur les 3 filtres : un classement "Cette semaine" est plus
 * lisible si son propre compteur de soirées reflète l'activité de cette
 * semaine-là, pas tout l'historique du joueur.
 */
export async function getScoreboard(
  period: ScoreboardPeriod,
  options: { communityId?: string | null } = {}
): Promise<ScoreboardEntry[]> {
  // PR B : undefined choisit default, null refuse le classement.
  // Une communauté explicite limite aussi les utilisateurs aux membres ACTIVE.
  const requestedId = options.communityId;
  if (requestedId === null) return [];
  const communityId = requestedId ?? await getDefaultCommunityId();
  const start = periodStart(period);

  // Statut de la communauté, client scopé et liste des utilisateurs sont
  // indépendants : une seule vague (avant, trois allers-retours enchaînés). Une
  // communauté non ACTIVE renvoie toujours [] ; la liste lue en trop est jetée.
  const [community, scopedDb, usersRaw] = await Promise.all([
    prisma.community.findUnique({ where: { id: communityId }, select: { status: true } }),
    scopedPrismaForCommunityId(communityId),
    prisma.user.findMany({
      ...(requestedId ? { where: { memberships: { some: { communityId, status: "ACTIVE" as const, community: { status: "ACTIVE" as const } } } } } : {}),
      select: { id: true, discordName: true, discordAvatar: true, color: true },
    }),
  ]);
  if (community?.status !== "ACTIVE") return [];

  const createdAtFilter = start ? { createdAt: { gte: start } } : {};
  const memberFilter = { communityId, userId: { in: usersRaw.map((u) => u.id) } };

  // Progressions et agrégats d'XP ne dépendent que de la liste des utilisateurs :
  // lus ensemble (avant, les soldes puis les agrégats, l'un après l'autre).
  const [stats, xpByUser, sessionsByUser, xpLast7Days] = await Promise.all([
    scopedDb.communityMemberStats.findMany({ where: memberFilter, select: { userId: true, xpTotal: true } }),
    period === "global"
      ? null
      : scopedDb.xpEvent.groupBy({
          by: ["userId"],
          where: { ...createdAtFilter, ...memberFilter, reason: { not: "SHOP_BALANCE_PURCHASE" } },
          _sum: { amount: true },
        }),
    scopedDb.xpEvent.groupBy({
      by: ["userId"],
      where: { reason: "PARTICIPATE", ...createdAtFilter, ...memberFilter },
      _count: { _all: true },
    }),
    // Amélioration classement — deltas de position ↑/↓ vs il y a 7 jours,
    // uniquement pour "Global" (seule période où la position est stable
    // dans le temps, pas réinitialisée). Reconstruit le total XP d'il y a
    // 7 jours par simple soustraction (`xpTotal` actuel moins les gains
    // de la semaine écoulée) plutôt que de maintenir un nouvel historique
    // en base — aucune table de snapshot hebdomadaire n'existe, et cette
    // approche donne exactement le même résultat sans migration.
    period === "global"
      ? scopedDb.xpEvent.groupBy({
          by: ["userId"],
          where: { createdAt: { gte: new Date(Date.now() - WEEK_DELTA_WINDOW_MS) }, ...memberFilter, reason: { not: "SHOP_BALANCE_PURCHASE" } },
          _sum: { amount: true },
        })
      : null,
  ]);
  const statsById = new Map(stats.map((s) => [s.userId, s.xpTotal]));
  const users = usersRaw.map((user) => ({ ...user, xpTotal: statsById.get(user.id) ?? 0 }));

  const xpMap = new Map(xpByUser?.map((row) => [row.userId, row._sum.amount ?? 0]));
  const sessionsMap = new Map(sessionsByUser.map((row) => [row.userId, row._count._all]));
  const xpGainedLast7DaysMap = new Map(
    xpLast7Days?.map((row) => [row.userId, row._sum.amount ?? 0])
  );
  const xpOneWeekAgoMap = new Map(
    users.map((u) => [u.id, u.xpTotal - (xpGainedLast7DaysMap.get(u.id) ?? 0)])
  );

  const entries: Omit<ScoreboardEntry, "weekDeltaPosition">[] = users.map((user) => {
    const level = levelForXp(user.xpTotal);
    const currentLevelXp = xpForLevel(level);
    const nextLevelXp = xpForLevel(level + 1);
    return {
      userId: user.id,
      discordName: user.discordName,
      discordAvatar: user.discordAvatar,
      color: user.color,
      level,
      rank: rankForLevel(level),
      title: titleForLevel(level),
      periodXp: period === "global" ? user.xpTotal : (xpMap.get(user.id) ?? 0),
      sessionsPlayed: sessionsMap.get(user.id) ?? 0,
      levelProgress: (user.xpTotal - currentLevelXp) / (nextLevelXp - currentLevelXp),
    };
  });

  entries.sort(
    (a, b) => b.periodXp - a.periodXp || a.discordName.localeCompare(b.discordName, "fr")
  );

  if (period !== "global") {
    return entries.map((entry) => ({ ...entry, weekDeltaPosition: null }));
  }

  const lastWeekOrder = [...entries]
    .sort((a, b) => {
      const diff = (xpOneWeekAgoMap.get(b.userId) ?? 0) - (xpOneWeekAgoMap.get(a.userId) ?? 0);
      return diff || a.discordName.localeCompare(b.discordName, "fr");
    })
    .map((entry) => entry.userId);

  return entries.map((entry, index) => ({
    ...entry,
    weekDeltaPosition: lastWeekOrder.indexOf(entry.userId) - index,
  }));
}

/** Classements annexes communautaires : temps et nombre de soirées par jeu, plus streak actif des membres. */
export async function getFunLeaderboards(options: { communityId?: string | null } = {}): Promise<FunLeaderboards> {
  const requestedId = options.communityId;
  if (requestedId === null) return { gamesByPlayTime: [], gamesByPlayCount: [], playersByStreak: [] };
  const communityId = requestedId ?? await getDefaultCommunityId();
  const [community, scopedDb, usersRaw] = await Promise.all([
    prisma.community.findUnique({ where: { id: communityId }, select: { status: true } }),
    scopedPrismaForCommunityId(communityId),
    prisma.user.findMany({
      ...(requestedId ? { where: { memberships: { some: { communityId, status: "ACTIVE" as const, community: { status: "ACTIVE" as const } } } } } : {}),
      select: { id: true },
    }),
  ]);
  if (community?.status !== "ACTIVE") return { gamesByPlayTime: [], gamesByPlayCount: [], playersByStreak: [] };
  const [games, gamesByPlayCount, players] = await Promise.all([
    scopedDb.groupGameStat.findMany({
      where: { communityId, totalPlayMinutes: { gt: 0 } },
      orderBy: { totalPlayMinutes: "desc" },
      take: 5,
      select: { gameId: true, totalPlayMinutes: true, game: { select: { name: true, coverUrl: true } } },
    }),
    scopedDb.groupGameStat.findMany({
      where: { communityId, playCount: { gt: 0 } },
      orderBy: [{ playCount: "desc" }, { gameId: "asc" }],
      take: 5,
      select: { gameId: true, playCount: true, game: { select: { name: true } } },
    }),
    scopedDb.communityMemberStats.findMany({
      where: { communityId, userId: { in: usersRaw.map((user) => user.id) }, streakCount: { gt: 0 }, streakLastActiveAt: { gte: new Date(Date.now() - ACTIVE_STREAK_WINDOW_MS) } },
      orderBy: [{ streakCount: "desc" }, { userId: "asc" }],
      take: 5,
      select: { userId: true, streakCount: true, user: { select: { discordName: true, discordAvatar: true, color: true } } },
    }),
  ]);
  return {
    gamesByPlayTime: games.map((game) => ({ gameId: game.gameId, name: game.game.name, coverUrl: game.game.coverUrl, totalPlayMinutes: game.totalPlayMinutes })),
    gamesByPlayCount: gamesByPlayCount.map((game) => ({ gameId: game.gameId, name: game.game.name, playCount: game.playCount })),
    playersByStreak: players.map((player) => ({ userId: player.userId, ...player.user, streakCount: player.streakCount })),
  };
}
