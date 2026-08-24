import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { LibraryTabs } from "@/components/LibraryTabs";
import { TierlistBoard } from "@/components/TierlistBoard";

/**
 * Tierlist perso (PR 6/9) — classe TOUTE la biblio commune (owned ou non
 * par le user courant), même périmètre que `/bibliotheque/groupe` : tous
 * les jeux avec au moins un `UserGame.owned` quelque part dans le groupe.
 * Permet de classer un jeu essayé chez un pote sans le posséder soi-même.
 */
export default async function TierlistPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const [games, entries] = await Promise.all([
    prisma.game.findMany({
      where: { userGames: { some: { owned: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.tierlistEntry.findMany({ where: { userId: user.id } }),
  ]);

  const initialTiers = Object.fromEntries(entries.map((e) => [e.gameId, e.tier]));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
        Ma tierlist
      </h1>

      <LibraryTabs active="tierlist" />

      {games.length === 0 ? (
        <p className="text-sm text-muted">
          Aucun jeu dans la bibliothèque commune pour l&apos;instant.
        </p>
      ) : (
        <TierlistBoard
          games={games.map((g) => ({ id: g.id, name: g.name, coverUrl: g.coverUrl }))}
          initialTiers={initialTiers}
        />
      )}
    </div>
  );
}
