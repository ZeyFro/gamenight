import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { BibliothequeGrid } from "@/components/BibliothequeGrid";
import { LibraryTabs } from "@/components/LibraryTabs";
import { ButtonLink } from "@/components/ui/Button";

export default async function BibliothequePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const userGames = await prisma.userGame.findMany({
    where: { userId: user.id, owned: true },
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
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
          Ma bibliothèque
        </h1>
        <ButtonLink href="/bibliotheque/ajouter" variant="primary" fullWidthOnMobile>
          + Ajouter un jeu
        </ButtonLink>
      </div>

      <LibraryTabs active="perso" />

      <BibliothequeGrid games={games} />
    </div>
  );
}
