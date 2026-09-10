import { prisma } from "@/lib/prisma";
import { getWeekStart } from "@/lib/calendar-dates";
import { levelForXp, rankForLevel } from "@/lib/xp";
import { announceGroupAchievementUnlocked } from "@/lib/discord-group-achievement";
import { logger } from "@/lib/logger";
import type { GroupAchievement } from "@prisma/client";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Les 10 trophées de groupe (Sprint 3 suite) — définitions de référence,
 * seedées en base par `seedGroupAchievements` (`src/lib/seed-group-achievements.ts`,
 * idempotent par `key`, même philosophie que `Badge`/`seedBadges`). Ce tableau
 * ne sert qu'au seed ; `checkGroupAchievements` ci-dessous lit les
 * critères depuis un `switch` sur `key`, pas depuis ce tableau (les
 * critères de groupe, contrairement à `Badge.criteria`, ne sont pas tous
 * de la forme `{type, count}` — certains sont des prédicats composites,
 * ex. "4 semaines consécutives").
 */
export const GROUP_ACHIEVEMENT_DEFS: {
  key: string;
  name: string;
  description: string;
  icon: string;
}[] = [
  { key: "premiere-soiree", name: "Première soirée", description: "1 soirée jouée.", icon: "🎮" },
  {
    key: "squad",
    name: "Squad",
    description: "5 joueurs différents ont participé.",
    icon: "👥",
  },
  {
    key: "marathoniens",
    name: "Marathoniens",
    description: "10 soirées jouées.",
    icon: "🏃",
  },
  {
    key: "diversite",
    name: "Diversité",
    description: "10 jeux différents joués.",
    icon: "🎲",
  },
  {
    key: "reguliers",
    name: "Réguliers",
    description: "4 semaines consécutives avec au moins 1 soirée.",
    icon: "📅",
  },
  {
    key: "noctambules",
    name: "Noctambules",
    description: "1 soirée commencée après 23h.",
    icon: "🌙",
  },
  { key: "century", name: "Century", description: "100 soirées jouées.", icon: "💯" },
  {
    key: "collectionneur-collectif",
    name: "Collectionneur collectif",
    description: "500 jeux dans la bibliothèque du groupe.",
    icon: "📚",
  },
  {
    key: "full-house",
    name: "Full House",
    description: "Une soirée avec TOUS les membres du groupe.",
    icon: "🏠",
  },
  {
    key: "legendaire",
    name: "Légendaire",
    description: "1 membre a atteint le rang Légende.",
    icon: "👑",
  },
];

/**
 * Recalcule et débloque les trophées de groupe encore verrouillés —
 * appelée à chaque `markSessionDone` (src/lib/sessions.ts, "clôture" au
 * sens spec = soirée passée `DONE`). Recalcul complet plutôt qu'un delta
 * incrémental : seulement 10 lignes à vérifier, et certains critères
 * (diversité, réguliers, légendaire...) ne se prêtent pas à un calcul
 * incrémental simple — le coût d'un recalcul complet est négligeable à
 * l'échelle d'un groupe de potes.
 *
 * Réclame chaque déblocage atomiquement (`updateMany` conditionné sur
 * `unlockedAt: null`, même mécanique que `claimSessionClose`) : si deux
 * clôtures tombent en même temps, chaque trophée n'est annoncé qu'une
 * fois. Retourne les trophées nouvellement débloqués (pour les confettis
 * de l'appelant, `?celebrate=achievement`).
 */
export async function checkGroupAchievements(): Promise<GroupAchievement[]> {
  const locked = await prisma.groupAchievement.findMany({ where: { unlockedAt: null } });
  if (locked.length === 0) return [];

  const doneSessions = await prisma.session.findMany({
    where: { status: "DONE" },
    select: {
      id: true,
      date: true,
      decidedGameId: true,
      proposals: { select: { gameId: true, votes: { select: { userId: true } } } },
    },
  });

  const totalDone = doneSessions.length;
  const distinctGames = new Set(doneSessions.map((s) => s.decidedGameId).filter(Boolean)).size;

  const allParticipantIds = new Set<string>();
  let hasNightSession = false;
  let fullHouseSessionParticipants = 0;
  const weekStartMsSet = new Set<number>();

  const totalUserCount = await prisma.user.count();

  for (const s of doneSessions) {
    const winningVotes = s.decidedGameId
      ? s.proposals.filter((p) => p.gameId === s.decidedGameId).flatMap((p) => p.votes)
      : [];
    const sessionParticipantIds = new Set(winningVotes.map((v) => v.userId));
    for (const id of sessionParticipantIds) allParticipantIds.add(id);

    if (sessionParticipantIds.size > fullHouseSessionParticipants) {
      fullHouseSessionParticipants = sessionParticipantIds.size;
    }
    if (s.date.getUTCHours() >= 23) hasNightSession = true;
    weekStartMsSet.add(getWeekStart(s.date).getTime());
  }

  const hasFullHouse = totalUserCount > 0 && fullHouseSessionParticipants === totalUserCount;

  const sortedWeeks = [...weekStartMsSet].sort((a, b) => a - b);
  let longestConsecutiveWeeks = sortedWeeks.length > 0 ? 1 : 0;
  let currentRun = 1;
  for (let i = 1; i < sortedWeeks.length; i++) {
    if (sortedWeeks[i] - sortedWeeks[i - 1] === WEEK_MS) {
      currentRun += 1;
      longestConsecutiveWeeks = Math.max(longestConsecutiveWeeks, currentRun);
    } else {
      currentRun = 1;
    }
  }

  const libraryGameGroups = await prisma.userGame.groupBy({
    by: ["gameId"],
    where: { owned: true },
  });
  const libraryGamesCount = libraryGameGroups.length;

  const users = await prisma.user.findMany({ select: { xpTotal: true } });
  const hasLegendaryUser = users.some((u) => rankForLevel(levelForXp(u.xpTotal)).name === "Légende");

  const predicateByKey: Record<string, boolean> = {
    "premiere-soiree": totalDone >= 1,
    squad: allParticipantIds.size >= 5,
    marathoniens: totalDone >= 10,
    diversite: distinctGames >= 10,
    reguliers: longestConsecutiveWeeks >= 4,
    noctambules: hasNightSession,
    century: totalDone >= 100,
    "collectionneur-collectif": libraryGamesCount >= 500,
    "full-house": hasFullHouse,
    legendaire: hasLegendaryUser,
  };

  const unlocked: GroupAchievement[] = [];
  for (const achievement of locked) {
    if (!predicateByKey[achievement.key]) continue;

    const claimed = await prisma.groupAchievement.updateMany({
      where: { id: achievement.id, unlockedAt: null },
      data: { unlockedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    unlocked.push({ ...achievement, unlockedAt: new Date() });

    const result = await announceGroupAchievementUnlocked(achievement);
    if (!result.ok) {
      logger.error(
        "group-achievements",
        `Trophée ${achievement.key} débloqué, mais échec de l'annonce Discord: ${result.error}`
      );
    }
  }

  return unlocked;
}
