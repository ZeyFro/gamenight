import { prisma } from "@/lib/prisma";
import { communityIdFilter, resolveActiveCommunityScope } from "@/lib/community-isolation";
import { lockCommunityProgress } from "@/lib/member-stats";

/** Appelé par l'onglet admin ; même frontière de communauté que les nettoyages. */
export async function listFailedRewardDeliveries(userId: string) {
  const scope = await resolveActiveCommunityScope(userId);
  return prisma.notificationDelivery.findMany({ where: {
    status: "FAILED", event: { category: "REWARD", eventType: "COMMUNITY_SYSTEM_ANNOUNCE", ...communityIdFilter(scope) },
  }, select: { id: true, transport: true, errorClass: true, lastError: true }, orderBy: { sequence: "asc" }, take: 100 });
}

/** Ne recrée ni événement ni notification et ne change jamais le transport. */
export async function retryRewardDelivery(userId: string, deliveryId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const scope = await resolveActiveCommunityScope(userId);
    const row = await tx.notificationDelivery.findFirst({ where: {
      id: deliveryId, status: "FAILED",
      event: { category: "REWARD", eventType: "COMMUNITY_SYSTEM_ANNOUNCE", ...communityIdFilter(scope) },
    }, select: { event: { select: { communityId: true } } } });
    if (!row?.event.communityId || !(await lockCommunityProgress(tx, row.event.communityId, userId))) return false;
    const result = await tx.notificationDelivery.updateMany({ where: { id: deliveryId, status: "FAILED" }, data: {
      status: "PENDING", attempts: 0, nextAttemptAt: null, errorClass: null, lastError: null,
      reservedBy: null, reservationToken: null, reservedUntil: null,
    } });
    return result.count === 1;
  });
}
