import { findActiveMembership, hasCommunityRole } from "@/lib/community-access";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import { statsCommunityIdForSession } from "@/lib/community-stats";
import { getSessionAccessRole } from "@/lib/session-access";

/** Modérer un contenu ne donne jamais accès à une soirée privée sans invitation. */
export async function canManageSessionContent(userId: string, sessionId: string): Promise<boolean> {
  const access = await getSessionAccessRole(userId, sessionId);
  if (!access) return false;
  if (access === "creator") return true;
  const scopedDb = await getScopedPrisma(userId);
  const session = await scopedDb.session.findUnique({ where: { id: sessionId }, select: { communityId: true } });
  if (!session) return false;
  const membership = await findActiveMembership(userId, await statsCommunityIdForSession(session.communityId));
  return !!membership && hasCommunityRole(membership.role, "ADMIN");
}
