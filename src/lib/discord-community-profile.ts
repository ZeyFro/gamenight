import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getMemberStats } from "@/lib/member-stats";
import { getTowerProgress } from "@/lib/tower-progression";
import { getTowerPersonalProgress } from "@/lib/tower-personal-progress";
import { rankForLevel, titleForLevel } from "@/lib/xp";
import { isTeamCaptain } from "@/lib/community-team-captain";

/**
 * Vue « profil communautaire » réutilisable par Discord (`/profil`) — même
 * source de vérité que la page `/ascension` :
 * - étage de progression et niveau : `getTowerProgress` (barème XP existant,
 *   `Community.towerLevelsPerFloor`) ;
 * - étages gagnés via les défis : `getTowerPersonalProgress` (uniquement si
 *   `TOWER_CHALLENGES_ENABLED`, comme la page pote) ;
 * - XP : `getMemberStats` (XP de la communauté, jamais `User.xpTotal` global).
 *
 * Aucune écriture, aucun nouveau barème, aucun mélange XP / étages / badges.
 * Lecture seule : un non-membre de la communauté Discord ne voit rien.
 */
export interface CommunityProfileView {
  communityName: string;
  displayName: string;
  level: number;
  levelTitle: string;
  rankName: string;
  floor: number;
  xpTotal: number;
  xpToNextFloor: number;
  /** `null` quand les défis Tower sont éteints : on n'affiche pas un zéro trompeur. */
  floorsWon: string | null;
  badges: number;
  games: number;
  teams: Array<{ name: string; game: string; captain: boolean; members: number; maxMembers: number }>;
}

export type CommunityProfileResult =
  | { status: "PROFILE"; profile: CommunityProfileView }
  | { status: "NOT_MEMBER" }
  | { status: "INVALID" };

const snowflake = z.string().regex(/^[0-9]{16,20}$/);
const inputSchema = z.object({ guildId: snowflake, discordId: snowflake });

export async function loadCommunityProfile(input: {
  guildId: string;
  discordId: string;
}): Promise<CommunityProfileResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" };
  const { guildId, discordId } = parsed.data;

  // Communauté et membre : la même réponse pour un serveur inconnu et pour un
  // non-membre, afin de ne rien révéler d'autre que « pas d'accès ».
  const community = await prisma.community.findFirst({
    where: { discordGuildId: guildId, status: "ACTIVE" },
    select: { id: true, name: true, towerLevelsPerFloor: true },
  });
  if (!community) return { status: "NOT_MEMBER" };

  const user = await prisma.user.findUnique({
    where: { discordId },
    select: { id: true, discordName: true },
  });
  if (!user) return { status: "NOT_MEMBER" };

  const membership = await prisma.membership.findUnique({
    where: { communityId_userId: { communityId: community.id, userId: user.id } },
    select: { status: true },
  });
  if (membership?.status !== "ACTIVE") return { status: "NOT_MEMBER" };

  const [stats, badges, games, teamMemberships] = await Promise.all([
    getMemberStats(user.id, community.id),
    prisma.userBadge.count({ where: { communityId: community.id, userId: user.id } }),
    prisma.userGame.count({ where: { userId: user.id } }),
    prisma.communityTeamMember.findMany({
      where: { communityId: community.id, userId: user.id },
      take: 5,
      select: {
        team: {
          select: {
            name: true,
            createdById: true,
            maxMembers: true,
            game: { select: { name: true } },
            _count: { select: { members: true } },
            // La capitainerie vient de `createdById` : on a besoin des membres
            // actifs pour vérifier qu'il en fait toujours partie.
            members: { select: { userId: true } },
          },
        },
      },
    }),
  ]);

  const progress = getTowerProgress(stats.xpTotal, community.towerLevelsPerFloor ?? 10);
  const rank = rankForLevel(progress.level);

  let floorsWon: string | null = null;
  if (process.env.TOWER_CHALLENGES_ENABLED === "true") {
    const tower = await getTowerPersonalProgress({
      viewerId: user.id,
      memberId: user.id,
      communityId: community.id,
    });
    floorsWon = tower.status === "PROGRESS" ? tower.floorsClimbed : null;
  }

  return {
    status: "PROFILE",
    profile: {
      communityName: community.name,
      displayName: user.discordName,
      level: progress.level,
      levelTitle: titleForLevel(progress.level),
      rankName: rank.name,
      floor: progress.floor,
      xpTotal: stats.xpTotal,
      xpToNextFloor: progress.xpToNextFloor,
      floorsWon,
      badges,
      games,
      teams: teamMemberships.map((entry) => ({
        name: entry.team.name,
        game: entry.team.game.name,
        captain: isTeamCaptain(
          { createdById: entry.team.createdById, activeMemberIds: entry.team.members.map((member) => member.userId) },
          user.id
        ),
        members: entry.team._count.members,
        maxMembers: entry.team.maxMembers,
      })),
    },
  };
}
