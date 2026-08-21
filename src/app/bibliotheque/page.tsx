import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { BibliothequeGrid } from "@/components/BibliothequeGrid";

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
        <div>
          <Link href="/profil" className="text-sm text-zinc-500 hover:underline">
            ← Profil
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-zinc-950 sm:text-2xl dark:text-zinc-50">
            Ma bibliothèque
          </h1>
        </div>
        <Link
          href="/bibliotheque/ajouter"
          className="w-full rounded-full bg-zinc-950 px-5 py-3 text-center text-base font-medium text-white transition-colors hover:bg-zinc-800 sm:w-auto sm:py-2.5 sm:text-sm dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          + Ajouter un jeu
        </Link>
      </div>

      <BibliothequeGrid games={games} />
    </div>
  );
}
