import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { ReadOnlyTierlist, type TierlistRowGame } from "@/components/ReadOnlyTierlist";
import type { Tier } from "@prisma/client";

/** Onglet "Tierlist" — voir `../layout.tsx` pour l'en-tête. */
export default async function PoteTierlistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id } = await params;

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
