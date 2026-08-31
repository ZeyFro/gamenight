import { prisma } from "@/lib/prisma";
import { levelForXp, rankForLevel, titleForLevel, type Rank } from "@/lib/xp";

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
export async function getScoreboard(period: ScoreboardPeriod): Promise<ScoreboardEntry[]> {
  const start = periodStart(period);

  const users = await prisma.user.findMany({
    select: { id: true, discordName: true, discordAvatar: true, color: true, xpTotal: true },
  });

  const createdAtFilter = start ? { createdAt: { gte: start } } : {};

  const [xpByUser, sessionsByUser] = await Promise.all([
    period === "global"
      ? null
      : prisma.xpEvent.groupBy({
          by: ["userId"],
          where: createdAtFilter,
          _sum: { amount: true },
        }),
    prisma.xpEvent.groupBy({
      by: ["userId"],
      where: { reason: "PARTICIPATE", ...createdAtFilter },
      _count: { _all: true },
    }),
  ]);

  const xpMap = new Map(xpByUser?.map((row) => [row.userId, row._sum.amount ?? 0]));
  const sessionsMap = new Map(sessionsByUser.map((row) => [row.userId, row._count._all]));

  const entries = users.map((user): ScoreboardEntry => {
    const level = levelForXp(user.xpTotal);
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
    };
  });

  entries.sort(
    (a, b) => b.periodXp - a.periodXp || a.discordName.localeCompare(b.discordName, "fr")
  );

  return entries;
}
