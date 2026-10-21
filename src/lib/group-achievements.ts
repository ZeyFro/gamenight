import { prisma } from "@/lib/prisma";
import { getActiveScopedPrisma, scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
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
 * fois, quel que soit le nombre d'appels concurrents ou successifs de
 * cette fonction (aucune ligne `GroupAchievement` déjà débloquée n'est
 * jamais réévaluée par le `for (const achievement of locked)` ci-dessous
 * — `locked` ne contient que les trophées encore `unlockedAt: null` —
 * donc jamais une double annonce Discord/notification pour le même
 * trophée). Retourne les trophées nouvellement débloqués (pour les
 * confettis de l'appelant, `?celebrate=achievement`).
 *
 * Chantier nettoyage réel du stockage (V2, suite — closes #107) — 5 des
 * 10 prédicats ci-dessous dépendaient d'un `Session.findMany({status:"DONE"})`
 * EN DIRECT, désormais purgeable 7 jours après la fin d'une soirée :
 * `totalDone`/`distinctGames`/`allParticipantIds`/`weekStartMsSet`
 * n'étaient recalculés QUE sur les soirées ENCORE VIVANTES au moment du
 * check, jamais sur l'historique complet — un trophée à seuil CUMULATIF
 * (marathoniens, century, diversité, squad, réguliers) pouvait donc ne
 * JAMAIS se débloquer une fois la purge active : dès que les soirées les
 * plus anciennes contribuant au total sortaient de la fenêtre de 7 jours
 * avant qu'un total suffisant ne soit un jour observé EN UNE SEULE fois
 * (concrètement quasi systématique pour "marathoniens"/10 soirées et
 * "century"/100 soirées, la purge à 7 jours rendant peu probable que 10,
 * a fortiori 100, soirées soient simultanément encore vivantes). Ces 5
 * prédicats lisent désormais des agrégats DURABLES
 * (`GroupSessionStats`/`GroupGameStat`/`XpEvent`/`GroupActiveWeek`),
 * jamais retouchés par la purge — voir chacun ci-dessous.
 *
 * `noctambules`/`full-house` restent lus depuis `doneSessions` EN DIRECT,
 * volontairement, PAS un oubli : ce sont des prédicats à seuil UNIQUE (1
 * occurrence suffit), et `checkGroupAchievements` est appelée
 * INCONDITIONNELLEMENT à CHAQUE `markSessionDone` — la soirée qui vient
 * de passer `DONE` est donc TOUJOURS encore vivante au moment de SON
 * PROPRE check (la purge exige 7 jours d'ancienneté minimum, largement
 * après ce premier passage), qu'une éventuelle purge future de soirées
 * plus anciennes n'affecte en rien. Aucune dépendance à un historique
 * accumulé sur plusieurs soirées à la fois, donc aucun risque — prouvé
 * par test (`group-achievements` dans `retention.integration.test.ts`)
 * plutôt qu'un nouvel agrégat durable inutile pour ces deux-là.
 */
export async function checkGroupAchievements(communityId: string): Promise<GroupAchievement[]> {
  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { status: true } });
  if (community?.status !== "ACTIVE") return [];
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  // Communauté sans aucun trophée (nouvelle) : on lui crée les siens ; sinon on ne touche à rien.
  if ((await scopedDb.groupAchievement.count({ where: { communityId } })) === 0) await ensureGroupAchievements(communityId);
  const locked = await scopedDb.groupAchievement.findMany({ where: { communityId, unlockedAt: null } });
  if (locked.length === 0) return [];
  const members = { memberships: { some: { communityId, status: "ACTIVE" as const, community: { status: "ACTIVE" as const } } } };

  const doneSessions = await scopedDb.session.findMany({
    where: { status: "DONE" },
    select: {
      date: true,
      decidedGameId: true,
      proposals: { select: { gameId: true, votes: { select: { userId: true } } } },
    },
  });

  let hasNightSession = false;
  let fullHouseSessionParticipants = 0;
  const totalUserCount = await prisma.user.count({ where: members });

  for (const s of doneSessions) {
    // "full-house" (participants à LA soirée qui vient de clôturer, ou à
    // toute autre soirée encore vivante) — seul le maximum importe, aucun
    // historique cumulé requis, jamais affecté par la purge d'une AUTRE
    // soirée (voir le commentaire de fonction ci-dessus).
    const winningVotes = s.decidedGameId
      ? s.proposals.filter((p) => p.gameId === s.decidedGameId).flatMap((p) => p.votes)
      : [];
    const sessionParticipantIds = new Set(winningVotes.map((v) => v.userId));
    if (sessionParticipantIds.size > fullHouseSessionParticipants) {
      fullHouseSessionParticipants = sessionParticipantIds.size;
    }
    if (s.date.getUTCHours() >= 23) hasNightSession = true;
  }
  const hasFullHouse = totalUserCount > 0 && fullHouseSessionParticipants === totalUserCount;

  // Durables — jamais retouchés par la purge (`retention.ts`), jamais un
  // mélange avec `doneSessions` ci-dessus pour ces 5 prédicats : une
  // seule source de vérité chacun, donc aucun double comptage possible
  // entre soirées encore présentes et soirées déjà purgées.
  const [sessionStats, distinctGamesCount, distinctParticipants, activeWeeks, libraryGameGroups, users] =
    await Promise.all([
      // "marathoniens"/"century"/"premiere-soiree" — total à vie, jamais
      // recalculé depuis les lignes `Session` (voir `GroupSessionStats`,
      // incrémenté UNE FOIS par soirée dans `markSessionDone`).
      scopedDb.groupSessionStats.findUnique({ where: { communityId }, select: { totalSessionsPlayed: true } }),
      // "diversité" — un jeu compte tant qu'il a été décidé au moins une
      // fois, MÊME si toutes ses soirées ont depuis été purgées
      // (`GroupGameStat` n'est jamais supprimé par la purge de `Session`,
      // seulement si le `Game` lui-même l'était — ne se produit jamais
      // dans ce chantier).
      scopedDb.groupGameStat.count({ where: { communityId } }),
      // "squad" — même définition EXACTE de "participant" que
      // `allParticipantIds` avant ce lot (voteurs de la proposition
      // gagnante) : `XpEvent` `reason: "PARTICIPATE"` est écrit pour
      // CETTE MÊME population, à la clôture du vote (`closeSession`,
      // src/lib/sessions.ts) — sans FK vers `Session`, déjà à l'abri de
      // toute purge, aucun nouveau schéma nécessaire.
      scopedDb.xpEvent.findMany({ where: { communityId, reason: "PARTICIPATE", user: members }, distinct: ["userId"], select: { userId: true } }),
      // "réguliers" — voir `GroupActiveWeek` (prisma/schema.prisma) : une
      // ligne par semaine calendaire ayant eu ≥1 soirée DONE, écrite dans
      // `markSessionDone`, jamais retouchée par la purge.
      scopedDb.groupActiveWeek.findMany({ where: { communityId }, select: { weekStart: true }, orderBy: { weekStart: "asc" } }),
      prisma.userGame.groupBy({ by: ["gameId"], where: { owned: true, user: members } }),
      scopedDb.communityMemberStats.findMany({ where: { communityId, user: members }, select: { xpTotal: true } }),
    ]);

  const totalDone = sessionStats?.totalSessionsPlayed ?? 0;

  const sortedWeeksMs = activeWeeks.map((w) => w.weekStart.getTime());
  let longestConsecutiveWeeks = sortedWeeksMs.length > 0 ? 1 : 0;
  let currentRun = 1;
  for (let i = 1; i < sortedWeeksMs.length; i++) {
    if (sortedWeeksMs[i] - sortedWeeksMs[i - 1] === WEEK_MS) {
      currentRun += 1;
      longestConsecutiveWeeks = Math.max(longestConsecutiveWeeks, currentRun);
    } else {
      currentRun = 1;
    }
  }

  const libraryGamesCount = libraryGameGroups.length;
  const hasLegendaryUser = users.some((u) => rankForLevel(levelForXp(u.xpTotal)).name === "Légende");

  const predicateByKey: Record<string, boolean> = {
    "premiere-soiree": totalDone >= 1,
    squad: distinctParticipants.length >= 5,
    marathoniens: totalDone >= 10,
    diversite: distinctGamesCount >= 10,
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

    const claimed = await scopedDb.groupAchievement.updateMany({
      where: { id: achievement.id, unlockedAt: null },
      data: { unlockedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    unlocked.push({ ...achievement, unlockedAt: new Date() });

    const result = await announceGroupAchievementUnlocked(achievement, communityId);
    if (!result.ok) {
      logger.error(
        "group-achievements",
        `Trophée ${achievement.key} débloqué, mais échec de l'annonce Discord: ${result.error}`
      );
    }
  }

  return unlocked;
}

/**
 * Trophées du groupe affichés sur l'accueil (carte « Trophées du groupe » et
 * accueil v2), débloqués d'abord : ceux de la communauté ACTIVE de `viewerId`
 * dans tous les modes. Une communauté sans trophées
 * (nouvelle) reçoit les siens à la première lecture.
 */
export async function listGroupAchievements(viewerId: string) {
  const scopedDb = await getActiveScopedPrisma(viewerId);
  const orderBy = [{ unlockedAt: "desc" as const }, { createdAt: "asc" as const }];
  const rows = await scopedDb.groupAchievement.findMany({ orderBy });
  if (rows.length >= GROUP_ACHIEVEMENT_DEFS.length) return rows;
  const activeId = await resolveActiveCommunityId(viewerId);
  if (activeId === null) return rows;
  await ensureGroupAchievements(activeId);
  return scopedDb.groupAchievement.findMany({ orderBy });
}

/**
 * Crée les trophées manquants d'UNE communauté (clé `(communityId, key)`,
 * idempotent : une ligne existante n'est ni recréée ni modifiée, `unlockedAt`
 * compris). Appelée à la clôture d'une soirée, à la lecture de l'accueil et par
 * `seedGroupAchievements`, pour qu'une communauté nouvelle ait ses trophées.
 */
export async function ensureGroupAchievements(communityId: string): Promise<void> {
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  await scopedDb.groupAchievement.createMany({
    data: GROUP_ACHIEVEMENT_DEFS.map((def) => ({ ...def, communityId })),
    skipDuplicates: true,
  });
}
