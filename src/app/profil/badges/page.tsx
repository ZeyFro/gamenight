import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { getCurrentMemberStats } from "@/lib/member-stats";
import { BadgeGrid, type BadgeGridItem } from "@/components/BadgeGrid";
import { FadeInView } from "@/components/ui/FadeInView";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Mes badges");

/**
 * Onglet "Badges" — voir `../layout.tsx` pour l'en-tête. PR B : le catalogue est
 * commun, les badges débloqués sont ceux de la communauté COURANTE.
 */
export default async function ProfilBadgesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { communityId } = await getCurrentMemberStats(user.id);
  const scopedDb = communityId === null ? null : await scopedPrismaForCommunityId(communityId);
  const [badges, unlocked] = await Promise.all([
    prisma.badge.findMany({ orderBy: { createdAt: "asc" } }),
    communityId === null || scopedDb === null
      ? []
      : scopedDb.userBadge.findMany({ where: { communityId, userId: user.id } }),
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

  return (
    <FadeInView>
      <BadgeGrid badges={items} />
    </FadeInView>
  );
}
