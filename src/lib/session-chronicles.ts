import type { CommunityRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getScopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { statsCommunityIdForSession } from "@/lib/community-stats";
import { accessibleSessionWhere } from "@/lib/session-access";
import { isSessionChroniclesEnabled, sessionChronicleInput } from "./session-chronicle-input";

async function withChronicles<T>(userId: string, communityId: string, work: (scopedDb: Prisma.TransactionClient, communityName: string, role: CommunityRole) => Promise<T>): Promise<T | null> {
  if (!isSessionChroniclesEnabled()) return null;
  return prisma.$transaction(async tx => {
    const [community] = await tx.$queryRaw<{ status: string; slug: string; name: string }[]>`SELECT status, slug, name FROM "Community" WHERE id = ${communityId} FOR SHARE`;
    const [membership] = await tx.$queryRaw<{ status: string; role: CommunityRole }[]>`SELECT status, role FROM "Membership" WHERE "communityId" = ${communityId} AND "userId" = ${userId} FOR SHARE`;
    if (community?.status !== "ACTIVE" || membership?.status !== "ACTIVE") return null;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: community.slug === "default" });
    return work(scopedDb, community.name, membership.role);
  });
}

export async function saveSessionChronicle(userId: string, sessionId: string, input: unknown): Promise<boolean> {
  if (!isSessionChroniclesEnabled() || !sessionId || sessionId.length > 128) return false;
  const text = sessionChronicleInput.safeParse(input);
  if (!text.success) return false;
  const scopedDb = await getScopedPrisma(userId);
  const session = await scopedDb.session.findFirst({ where: { id: sessionId, ...accessibleSessionWhere(userId) }, select: { communityId: true, createdById: true } });
  if (!session) return false;
  const communityId = await statsCommunityIdForSession(session.communityId);
  if (await resolveActiveCommunityId(userId) !== communityId) return false;
  return await withChronicles(userId, communityId, async (scopedDb, _communityName, role) => {
    if (session.createdById !== userId && role !== "ADMIN" && role !== "OWNER") return false;
    // L'update verrouille la même ligne que la purge, qui relit chronicle sous verrou.
    const result = await scopedDb.session.updateMany({
      where: { id: sessionId, status: "DONE", ...accessibleSessionWhere(userId) },
      data: { chronicle: text.data },
    });
    return result.count === 1;
  }) ?? false;
}

export async function listSessionChronicles(userId: string, page: number) {
  if (!isSessionChroniclesEnabled() || !Number.isInteger(page) || page < 1 || page > 10000) return null;
  const communityId = await resolveActiveCommunityId(userId);
  if (!communityId) return null;
  return withChronicles(userId, communityId, async (scopedDb, communityName) => {
    const rows = await scopedDb.session.findMany({
      where: { AND: [accessibleSessionWhere(userId), { status: "DONE", chronicle: { not: null } }] },
      orderBy: [{ date: "desc" }, { id: "desc" }], skip: (page - 1) * 20, take: 21,
      select: { id: true, date: true, chronicle: true, decidedGame: { select: { name: true } }, createdBy: { select: { discordName: true } } },
    });
    return { communityName, items: rows.slice(0, 20), hasNext: rows.length > 20 };
  });
}
