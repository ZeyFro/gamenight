import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { scopedPrismaForCommunityId, type ScopedPrisma } from "@/lib/community-scoped-client";
import { writeCommunityIdForUser } from "@/lib/community-stats";

/**
 * Multi-communautés, PR B — solde XP, streak de connexion et compteur durable de
 * tournois d'un membre DANS une communauté (`CommunityMemberStats`). Remplace les
 * colonnes héritées `User.xpTotal` / `streakCount` / `streakLastActiveAt` /
 * `bestStreakCount` et `UserLifetimeStats` : un membre de deux serveurs a deux
 * soldes, deux streaks et deux compteurs indépendants.
 *
 * Une ligne est créée à la demande ; absente, tout vaut zéro. Les lectures et
 * écritures passent par le client scopé sur UNE communauté connue : transparent
 * quand l'isolation est éteinte, sinon restreint à cette communauté.
 */

export interface MemberStats {
  xpTotal: number;
  streakCount: number;
  streakLastActiveAt: Date | null;
  bestStreakCount: number;
  tournamentsParticipatedCount: number;
}

export const EMPTY_MEMBER_STATS: MemberStats = {
  xpTotal: 0,
  streakCount: 0,
  streakLastActiveAt: null,
  bestStreakCount: 0,
  tournamentsParticipatedCount: 0,
};

const STATS_SELECT = {
  xpTotal: true,
  streakCount: true,
  streakLastActiveAt: true,
  bestStreakCount: true,
  tournamentsParticipatedCount: true,
} as const;

/** Statistiques de `userId` dans `communityId` (zéro partout si le membre n'a encore rien gagné). */
export async function getMemberStats(userId: string, communityId: string): Promise<MemberStats> {
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  const row = await scopedDb.communityMemberStats.findUnique({
    where: { communityId_userId: { communityId, userId } },
    select: STATS_SELECT,
  });
  return row ?? EMPTY_MEMBER_STATS;
}

/** Statistiques de plusieurs membres d'une communauté, indexées par `userId` (absent = zéro). */
export async function getMemberStatsMap(communityId: string, userIds?: string[]): Promise<Map<string, MemberStats>> {
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  const rows = await scopedDb.communityMemberStats.findMany({
    where: { communityId, ...(userIds ? { userId: { in: userIds } } : {}) },
    select: { userId: true, ...STATS_SELECT },
  });
  return new Map(rows.map(({ userId, ...stats }) => [userId, stats]));
}

/**
 * Communauté « courante » de `userId` et ses statistiques : sa communauté active
 * (isolation allumée), ou la communauté par défaut (éteinte). `communityId` vaut
 * `null` si l'utilisateur n'a aucune communauté : rien n'est affiché, tout est à zéro.
 * Mémoïsée par requête serveur : un layout et sa page n'interrogent la base qu'une fois.
 */
export const getCurrentMemberStats = cache(
  async (userId: string): Promise<{ communityId: string | null; stats: MemberStats }> => {
    const communityId = await writeCommunityIdForUser(userId);
    if (communityId === null) return { communityId: null, stats: EMPTY_MEMBER_STATS };
    return { communityId, stats: await getMemberStats(userId, communityId) };
  }
);

/**
 * Crée la ligne de statistiques si elle manque (`ON CONFLICT DO NOTHING`, sans erreur
 * en cas de création concurrente). À appeler avant un `update` à incrément : deux
 * premiers gains simultanés ne peuvent ainsi jamais se heurter à la clé unique.
 */
export async function ensureMemberStatsRow(
  db: Pick<ScopedPrisma, "communityMemberStats">,
  communityId: string,
  userId: string
): Promise<void> {
  await db.communityMemberStats.createMany({ data: [{ communityId, userId }], skipDuplicates: true });
}

/**
 * Ajuste (`delta` = +1 / -1) le compteur durable de tournois d'un membre dans une
 * communauté, DANS la transaction de l'appelant (inscription / désinscription). Une
 * seule instruction `INSERT … ON CONFLICT DO UPDATE` : atomique même si la ligne
 * n'existe pas encore, et le compteur ne descend jamais sous zéro. SQL brut
 * volontaire (le client de transaction de l'appelant n'est pas scopé) : la clé
 * est explicitement `(communityId, userId)`.
 */
export async function bumpTournamentsParticipated(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  communityId: string,
  userId: string,
  delta: 1 | -1
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "CommunityMemberStats" ("id", "communityId", "userId", "tournamentsParticipatedCount", "updatedAt")
    VALUES (gen_random_uuid()::text, ${communityId}, ${userId}, GREATEST(0, ${delta}), now())
    ON CONFLICT ("communityId", "userId") DO UPDATE
    SET "tournamentsParticipatedCount" = GREATEST(0, "CommunityMemberStats"."tournamentsParticipatedCount" + ${delta}),
        "updatedAt" = now()
  `;
}

/** Nombre de badges de `userId` dans sa communauté courante (zéro sans communauté). */
export async function countCurrentCommunityBadges(userId: string): Promise<number> {
  const { communityId } = await getCurrentMemberStats(userId);
  if (communityId === null) return 0;
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  return scopedDb.userBadge.count({ where: { communityId, userId } });
}
