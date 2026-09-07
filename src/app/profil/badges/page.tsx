import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { BadgeGrid, type BadgeGridItem } from "@/components/BadgeGrid";
import { FadeInView } from "@/components/ui/FadeInView";

/** Onglet "Badges" — voir `../layout.tsx` pour l'en-tête. */
export default async function ProfilBadgesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const [badges, unlocked] = await Promise.all([
    prisma.badge.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.userBadge.findMany({ where: { userId: user.id } }),
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
