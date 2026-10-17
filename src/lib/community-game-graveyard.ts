import type { CommunityRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { isCommunityGameGraveyardEnabled, parseGameEpitaph } from "@/lib/community-game-graveyard-input";
import { wallClockNow } from "@/lib/wallclock";

type Access = { community: { id: string; name: string }; role: CommunityRole };

async function withGraveyard<T>(userId: string, work: (scopedDb: Prisma.TransactionClient, access: Access) => Promise<T>, expectedCommunityId?: string): Promise<T | null> {
  if (!isCommunityGameGraveyardEnabled()) return null;
  const communityId = await resolveActiveCommunityId(userId);
  if (!communityId || (expectedCommunityId !== undefined && expectedCommunityId !== communityId)) return null;
  return prisma.$transaction(async tx => {
    // L’accès reste valide jusqu’au commit, même si un retrait ou une suspension arrive en parallèle.
    const [community] = await tx.$queryRaw<{ status: string; name: string }[]>`SELECT status, name FROM "Community" WHERE id = ${communityId} FOR SHARE`;
    const [member] = await tx.$queryRaw<{ status: string; role: CommunityRole }[]>`SELECT status, role FROM "Membership" WHERE "communityId" = ${communityId} AND "userId" = ${userId} FOR SHARE`;
    if (community?.status !== "ACTIVE" || member?.status !== "ACTIVE") return null;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    return work(scopedDb, { community: { id: communityId, name: community.name }, role: member.role });
  });
}

function eligibleGameWhere(communityId: string): Prisma.GameWhereInput {
  return { OR: [
    { userGames: { some: { owned: true, user: { memberships: { some: { communityId, status: "ACTIVE" } } } } } },
    { groupStats: { some: { communityId, playCount: { gt: 0 } } } },
  ] };
}

export async function listCommunityGameGraveyard(userId: string, query = "") {
  if (typeof query !== "string" || query.length > 100) return null;
  return withGraveyard(userId, async (scopedDb, access) => {
    const [entries, games] = await Promise.all([
      scopedDb.communityGameEpitaph.findMany({
        where: { communityId: access.community.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, epitaph: true, createdById: true, game: { select: { id: true, name: true } } },
      }),
      scopedDb.game.findMany({
        where: { ...eligibleGameWhere(access.community.id), name: { contains: query.trim(), mode: "insensitive" }, epitaphs: { none: { communityId: access.community.id } } },
        select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 101,
      }),
    ]);
    return { ...access, entries, games: games.slice(0, 100), hasMoreGames: games.length > 100 };
  });
}

export async function saveCommunityGameEpitaph(userId: string, id: unknown, gameId: unknown, epitaph: unknown, expectedCommunityId?: string) {
  const data = parseGameEpitaph(gameId, epitaph);
  if (!data || (id !== null && (typeof id !== "string" || !id || id.length > 100))) return "invalid" as const;
  return await withGraveyard(userId, async (scopedDb, access) => {
    const now = wallClockNow();
    if (id === null) {
      const eligible = await scopedDb.game.findFirst({ where: { id: data.gameId, ...eligibleGameWhere(access.community.id) }, select: { id: true } });
      if (!eligible) return "unavailable" as const;
      const result = await scopedDb.communityGameEpitaph.createMany({
        data: [{ ...data, communityId: access.community.id, createdById: userId, createdAt: now, updatedAt: now }], skipDuplicates: true,
      });
      return result.count ? "saved" as const : "exists" as const;
    }
    const result = await scopedDb.communityGameEpitaph.updateMany({
      where: { id, gameId: data.gameId, communityId: access.community.id, ...(access.role === "ADMIN" || access.role === "OWNER" ? {} : { createdById: userId }) },
      data: { epitaph: data.epitaph, updatedAt: now },
    });
    return result.count ? "saved" as const : "unavailable" as const;
  }, expectedCommunityId) ?? "unavailable";
}

export async function deleteCommunityGameEpitaph(userId: string, id: unknown, expectedCommunityId?: string) {
  if (typeof id !== "string" || !id || id.length > 100) return "invalid" as const;
  return await withGraveyard(userId, async (scopedDb, access) => {
    const result = await scopedDb.communityGameEpitaph.deleteMany({ where: { id, communityId: access.community.id, ...(access.role === "ADMIN" || access.role === "OWNER" ? {} : { createdById: userId }) } });
    return result.count ? "deleted" as const : "unavailable" as const;
  }, expectedCommunityId) ?? "unavailable";
}
