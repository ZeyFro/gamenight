import { notFound, redirect } from "next/navigation";
import { canViewPote } from "@/lib/community-isolation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { getCurrentMemberStats } from "@/lib/member-stats";
import { BadgeGrid, type BadgeGridItem } from "@/components/BadgeGrid";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Badges d'un pote");

/**
 * Onglet "Badges" — voir `../layout.tsx` pour l'en-tête. Lecture seule. PR B : les badges
 * affichés sont ceux gagnés par ce pote dans la communauté COURANTE du spectateur.
 */
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

  const { communityId } = await getCurrentMemberStats(user.id);
  const scopedDb = communityId === null ? null : await scopedPrismaForCommunityId(communityId);
  const [badges, unlocked] = await Promise.all([
    prisma.badge.findMany({ orderBy: { createdAt: "asc" } }),
    communityId === null || scopedDb === null
      ? []
      : scopedDb.userBadge.findMany({ where: { communityId, userId: id } }),
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
