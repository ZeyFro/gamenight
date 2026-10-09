import { prisma } from "@/lib/prisma";
import { scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { getDefaultCommunityId } from "@/lib/default-community";
import { getMemberStatsMap } from "@/lib/member-stats";
import { levelForXp, rankForLevel, titleForLevel, xpForLevel, type Rank } from "@/lib/xp";

const WEEK_DELTA_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const SCOREBOARD_PERIODS = ["global", "month", "week"] as const;
export type ScoreboardPeriod = (typeof SCOREBOARD_PERIODS)[number];

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
 * "Global" (pas de borne, on utilise directement `User.xpTotal`). Semaine
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
 * sur `xpTotal` à vie (`levelForXp`) **quelle que soit la période
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
  // Multi-communautés : `undefined` = tous les utilisateurs (isolation éteinte,
  // requêtes historiques, XP de la communauté par défaut) ; `null` = aucune
  // communauté, classement vide ; sinon uniquement les membres ACTIVE de cette
  // communauté. PR B : le solde (`CommunityMemberStats.xpTotal`) ET les
  // événements XP sont ceux de CETTE communauté — gagner de l'XP dans un autre
  // serveur ne change jamais le classement ici.
  const { communityId } = options;
  if (communityId === null) return [];
  const statsCommunityId = communityId ?? (await getDefaultCommunityId());
  const scopedDb = await scopedPrismaForCommunityId(statsCommunityId);

  const start = periodStart(period);

  const baseUsers = await prisma.user.findMany({
    ...(communityId ? { where: { memberships: { some: { communityId, status: "ACTIVE" as const } } } } : {}),
    select: { id: true, discordName: true, discordAvatar: true, color: true },
  });
  const statsByUser = await getMemberStatsMap(statsCommunityId, baseUsers.map((u) => u.id));
  const users = baseUsers.map((u) => ({ ...u, xpTotal: statsByUser.get(u.id)?.xpTotal ?? 0 }));

  const createdAtFilter = start ? { createdAt: { gte: start } } : {};
  const memberFilter = { communityId: statsCommunityId, userId: { in: users.map((u) => u.id) } };

  const [xpByUser, sessionsByUser, xpLast7Days] = await Promise.all([
    period === "global"
      ? null
      : scopedDb.xpEvent.groupBy({
          by: ["userId"],
          where: { ...createdAtFilter, ...memberFilter },
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
          where: { createdAt: { gte: new Date(Date.now() - WEEK_DELTA_WINDOW_MS) }, ...memberFilter },
          _sum: { amount: true },
        })
      : null,
  ]);

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
