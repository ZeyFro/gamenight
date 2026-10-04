import { notFound, redirect } from "next/navigation";
import { canViewPote } from "@/lib/community-isolation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { ReadOnlyTierlist, type TierlistRowGame } from "@/components/ReadOnlyTierlist";
import type { Tier } from "@prisma/client";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Tier list d'un pote");

/** Onglet "Tierlist" — voir `../layout.tsx` pour l'en-tête. */
export default async function PoteTierlistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id } = await params;
  // Multi-communautés (PR4) : un layout n'est pas garanti de s'exécuter avant
  // la page (navigation client) — contrôle répété dans chaque page.
  if (!(await canViewPote(user.id, id))) notFound();

  const tierlistEntries = await prisma.tierlistEntry.findMany({
    where: { userId: id },
    include: { game: true },
  });
  const tierlistByTier: Partial<Record<Tier, TierlistRowGame[]>> = {};
  for (const entry of tierlistEntries) {
    const list = tierlistByTier[entry.tier] ?? [];
    list.push({ id: entry.game.id, name: entry.game.name, coverUrl: entry.game.coverUrl });
    tierlistByTier[entry.tier] = list;
  }

  return (
    <ReadOnlyTierlist
      gamesByTier={tierlistByTier}
      emptyMessage="Pas encore de jeu classé."
    />
  );
}
