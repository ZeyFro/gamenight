import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { ReadOnlyGameGrid } from "@/components/ReadOnlyGameGrid";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Bibliothèque d'un pote");

/** Onglet "Bibliothèque" — voir `../layout.tsx` pour l'en-tête. */
export default async function PoteBibliothequePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id } = await params;

  const userGames = await prisma.userGame.findMany({
    where: { userId: id, owned: true },
    include: { game: true },
    orderBy: { game: { name: "asc" } },
  });

  const games = userGames.map(({ game }) => ({
    id: game.id,
    name: game.name,
    coverUrl: game.coverUrl,
    source: game.source,
    isCoop: game.isCoop,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
  }));

  return (
    <ReadOnlyGameGrid
      games={games}
      emptyMessage="Pas encore de jeu dans cette bibliothèque."
      showAddButton
    />
  );
}
