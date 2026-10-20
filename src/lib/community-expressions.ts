import type { CommunityRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { isCommunityExpressionsEnabled, parseCommunityExpression } from "@/lib/community-expressions-input";
import { wallClockNow } from "@/lib/wallclock";

type Access = { community: { id: string; name: string }; role: CommunityRole };

async function withExpressions<T>(userId: string, work: (scopedDb: Prisma.TransactionClient, access: Access) => Promise<T>, expectedCommunityId?: string): Promise<T | null> {
  if (!isCommunityExpressionsEnabled()) return null;
  const communityId = await resolveActiveCommunityId(userId);
  if (!communityId || (expectedCommunityId !== undefined && expectedCommunityId !== communityId)) return null;
  return prisma.$transaction(async tx => {
    // Ces verrous empêchent un retrait ou une suspension entre la vérification et l’écriture.
    const [community] = await tx.$queryRaw<{ status: string; name: string }[]>`SELECT status, name FROM "Community" WHERE id = ${communityId} FOR SHARE`;
    const [member] = await tx.$queryRaw<{ status: string; role: CommunityRole }[]>`SELECT status, role FROM "Membership" WHERE "communityId" = ${communityId} AND "userId" = ${userId} FOR SHARE`;
    if (community?.status !== "ACTIVE" || member?.status !== "ACTIVE") return null;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    return work(scopedDb, { community: { id: communityId, name: community.name }, role: member.role });
  });
}

export async function listCommunityExpressions(userId: string) {
  return withExpressions(userId, async (scopedDb, access) => {
    const entries = await scopedDb.communityExpression.findMany({
      where: { communityId: access.community.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, title: true, meaning: true, createdById: true },
    });
    return { ...access, entries };
  });
}

export async function saveCommunityExpression(userId: string, id: unknown, title: unknown, meaning: unknown, expectedCommunityId?: string) {
  const data = parseCommunityExpression(title, meaning);
  if (!data || (id !== null && (typeof id !== "string" || !id || id.length > 100))) return "invalid" as const;
  return await withExpressions(userId, async (scopedDb, access) => {
    if (access.role !== "ADMIN" && access.role !== "OWNER") return "unavailable" as const;
    const now = wallClockNow();
    if (id === null) {
      await scopedDb.communityExpression.create({ data: { ...data, communityId: access.community.id, createdById: userId, createdAt: now, updatedAt: now } });
      return "saved" as const;
    }
    const result = await scopedDb.communityExpression.updateMany({
      where: { id, communityId: access.community.id },
      data: { ...data, updatedAt: now },
    });
    return result.count ? "saved" as const : "unavailable" as const;
  }, expectedCommunityId) ?? "unavailable";
}

export async function deleteCommunityExpression(userId: string, id: unknown, expectedCommunityId?: string) {
  if (typeof id !== "string" || !id || id.length > 100) return "invalid" as const;
  return await withExpressions(userId, async (scopedDb, access) => {
    if (access.role !== "ADMIN" && access.role !== "OWNER") return "unavailable" as const;
    const result = await scopedDb.communityExpression.deleteMany({ where: { id, communityId: access.community.id } });
    return result.count ? "deleted" as const : "unavailable" as const;
  }, expectedCommunityId) ?? "unavailable";
}
