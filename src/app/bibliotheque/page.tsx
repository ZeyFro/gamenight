import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { removeUserGame } from "@/app/actions";

const SOURCE_LABELS: Record<string, string> = {
  STEAM: "Steam",
  IGDB: "IGDB",
  MANUAL: "Manuel",
};

export default async function BibliothequePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const userGames = await prisma.userGame.findMany({
    where: { userId: user.id, owned: true },
    include: { game: true },
    orderBy: { game: { name: "asc" } },
  });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/profil" className="text-sm text-zinc-500 hover:underline">
            ← Profil
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
            Ma bibliothèque
          </h1>
        </div>
        <Link
          href="/bibliotheque/ajouter"
          className="rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          + Ajouter un jeu
        </Link>
      </div>

      {userGames.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-sm text-zinc-600 shadow-sm dark:bg-zinc-950 dark:text-zinc-400">
          Ta bibliothèque est vide pour l&apos;instant. Lie ton compte Steam
          depuis ton profil pour importer tes jeux, ou ajoute-en un
          manuellement.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {userGames.map(({ game }) => (
            <div
              key={game.id}
              className="flex flex-col overflow-hidden rounded-xl bg-white shadow-sm dark:bg-zinc-950"
            >
              <div className="relative aspect-[2/3] w-full bg-zinc-200 dark:bg-zinc-800">
                {game.coverUrl && (
                  <Image
                    src={game.coverUrl}
                    alt={game.name}
                    fill
                    sizes="(max-width: 640px) 50vw, 25vw"
                    className="object-cover"
                  />
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-3">
                <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                  {game.name}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-900">
                    {SOURCE_LABELS[game.source] ?? game.source}
                  </span>
                  {(game.minPlayers || game.maxPlayers) && (
                    <span>
                      {game.minPlayers ?? "?"}–{game.maxPlayers ?? "?"} joueurs
                    </span>
                  )}
                  {game.isCoop && <span>· coop</span>}
                </div>
                <form action={removeUserGame} className="mt-auto pt-2">
                  <input type="hidden" name="gameId" value={game.id} />
                  <button
                    type="submit"
                    className="text-xs text-red-600 hover:underline dark:text-red-400"
                  >
                    Retirer de ma biblio
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
