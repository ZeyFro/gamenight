import type { CommunityRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { wallClockNow } from "@/lib/wallclock";
import { createOnce } from "@/lib/creation-intent";
import { highlightInput, isCommunityHighlightsEnabled } from "./community-highlights-input";

type Access = { communityId: string; communityName: string; canModerate: boolean };

async function withHighlights<T>(userId: string, work: (scopedDb: Prisma.TransactionClient, access: Access) => Promise<T>, expectedCommunityId?: string): Promise<T | null> {
  if (!isCommunityHighlightsEnabled()) return null;
  const communityId = await resolveActiveCommunityId(userId);
  if (!communityId || (expectedCommunityId !== undefined && expectedCommunityId !== communityId)) return null;
  return prisma.$transaction(async tx => {
    const [community] = await tx.$queryRaw<{ status: string; name: string }[]>`SELECT status, name FROM "Community" WHERE id = ${communityId} FOR SHARE`;
    const [member] = await tx.$queryRaw<{ status: string; role: CommunityRole }[]>`SELECT status, role FROM "Membership" WHERE "communityId" = ${communityId} AND "userId" = ${userId} FOR SHARE`;
    if (community?.status !== "ACTIVE" || member?.status !== "ACTIVE") return null;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    return work(scopedDb, { communityId, communityName: community.name, canModerate: member.role === "ADMIN" || member.role === "OWNER" });
  });
}

export async function listCommunityHighlights(userId: string, page: number) {
  if (!Number.isInteger(page) || page < 1 || page > 10000) return null;
  return withHighlights(userId, async (scopedDb, access) => {
    const items = await scopedDb.communityHighlight.findMany({
      where: { communityId: access.communityId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 50, take: 51,
      include: { createdBy: { select: { discordName: true } } },
    });
    return { ...access, items: items.slice(0, 50), hasNext: items.length > 50 };
  });
}

export async function saveCommunityHighlight(userId: string, id: string | null, input: unknown, options?: { creationKey?: string; communityId?: string }): Promise<boolean> {
  const parsed = highlightInput.safeParse(input);
  if (!parsed.success || (id !== null && (!id || id.length > 128))) return false;
  return await withHighlights(userId, async (scopedDb, access) => {
    const now = wallClockNow();
    if (!id) {
      const saved = await createOnce(userId, "community-highlight", options?.creationKey,
        async () => scopedDb.communityHighlight.create({ data: { ...parsed.data, communityId: access.communityId, createdById: userId, createdAt: now, updatedAt: now } }),
        row => row.id,
        (_tx, resourceId) => scopedDb.communityHighlight.findFirstOrThrow({ where: { id: resourceId, communityId: access.communityId, createdById: userId } }),
        scopedDb,
      );
      return !!saved.result;
    }
    const result = await scopedDb.communityHighlight.updateMany({
      where: { id, communityId: access.communityId, ...(access.canModerate ? {} : { createdById: userId }) },
      data: { ...parsed.data, updatedAt: now },
    });
    return result.count === 1;
  }, options?.communityId) ?? false;
}

export async function deleteCommunityHighlight(userId: string, id: string, communityId?: string): Promise<boolean> {
  if (!id || id.length > 128) return false;
  return await withHighlights(userId, async (scopedDb, access) => {
    const result = await scopedDb.communityHighlight.deleteMany({
      where: { id, communityId: access.communityId, ...(access.canModerate ? {} : { createdById: userId }) },
    });
    return result.count === 1;
  }, communityId) ?? false;
}
