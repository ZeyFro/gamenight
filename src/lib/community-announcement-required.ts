import { prisma } from "@/lib/prisma";
import { DEFAULT_COMMUNITY_SLUG } from "@/lib/default-community";

/** A nondefault creation cannot fall through to the historical webhook. */
export async function requireCommunityBotAnnouncement(communityId: string | null, viaBot: boolean): Promise<void> {
  if (!communityId || viaBot) return;
  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { slug: true } });
  if (community?.slug !== DEFAULT_COMMUNITY_SLUG) {
    throw new Error("Les annonces Discord de ce serveur ne sont pas configurées. Relance /gamenight setup ou contacte un admin GameNight.");
  }
}
