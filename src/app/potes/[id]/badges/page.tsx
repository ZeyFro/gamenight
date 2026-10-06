import { notFound, redirect } from "next/navigation";
import { canViewPote } from "@/lib/community-isolation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getActiveScopedPrisma } from "@/lib/community-scoped-client";
import { writeCommunityIdForUser } from "@/lib/community-stats";
import { BadgeGrid, type BadgeGridItem } from "@/components/BadgeGrid";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Badges d'un pote");

/** Onglet "Badges" — voir `../layout.tsx` pour l'en-tête. Lecture seule. */
export default async function PoteBadgesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id } = await params;
  // Multi-communautés (PR4) : contrôle répété dans chaque page (voir tierlist).
  if (!(await canViewPote(user.id, id))) notFound();
  const scopedDb = await getActiveScopedPrisma(user.id);
  const communityId = await writeCommunityIdForUser(user.id);

  const [badges, unlocked] = await Promise.all([
    prisma.badge.findMany({ orderBy: { createdAt: "asc" } }),
    scopedDb.userBadge.findMany({ where: { userId: id, communityId: { in: communityId ? [communityId] : [] } } }),
  ]);
  const unlockedAtByBadgeId = new Map(unlocked.map((u) => [u.badgeId, u.unlockedAt]));

  const items: BadgeGridItem[] = badges.map((badge) => ({
    id: badge.id,
    icon: badge.icon,
    name: badge.name,
    description: badge.description,
    category: badge.category,
    rarity: badge.rarity,
    unlockedAt: unlockedAtByBadgeId.get(badge.id) ?? null,
  }));

  return <BadgeGrid badges={items} />;
}
