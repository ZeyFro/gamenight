import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getGameOwnerCounts, getTotalUserCount, toFilterableGame } from "@/lib/game-library";
import { collectAvailableGenres, matchesGameFilters, parseGameFilters } from "@/lib/game-filters";
import { LibraryTabs } from "@/components/LibraryTabs";
import { GameFilterDrawer } from "@/components/GameFilterDrawer";
import { TierlistBoard } from "@/components/TierlistBoard";

/**
 * Tierlist perso (PR 6/9) — classe TOUTE la biblio commune (owned ou non
 * par le user courant), même périmètre que `/bibliotheque/groupe` : tous
 * les jeux avec au moins un `UserGame.owned` quelque part dans le groupe.
 * Permet de classer un jeu essayé chez un pote sans le posséder soi-même.
 *
 * Filtres bibliothèque (PR 31, 2/4 — Bloc B) appliqués ici aussi, en
 * amont de `TierlistBoard` : la recherche par nom déjà présente dans
 * `TierlistBoard` (PR 26 Fix 2) continue de filtrer par-dessus, côté
 * client, sur la liste déjà restreinte par les filtres structurés — les
 * deux mécanismes se superposent sans se marcher dessus.
 */
export default async function TierlistPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const [allGames, entries, ownerCounts, totalUsers] = await Promise.all([
    prisma.game.findMany({
      where: { userGames: { some: { owned: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.tierlistEntry.findMany({ where: { userId: user.id } }),
    getGameOwnerCounts(),
    getTotalUserCount(),
  ]);

  const initialTiers = Object.fromEntries(entries.map((e) => [e.gameId, e.tier]));

  const filterableGames = allGames.map(toFilterableGame);
  const filters = parseGameFilters(await searchParams);
  const games = allGames.filter((game, index) =>
    matchesGameFilters(filterableGames[index], ownerCounts.get(game.id) ?? 0, filters)
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
        Ma tierlist
      </h1>

      <LibraryTabs active="tierlist" />

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {games.length} jeu{games.length === 1 ? "" : "x"}
          {games.length !== allGames.length && ` sur ${allGames.length}`}
        </p>
        <GameFilterDrawer
          availableGenres={collectAvailableGenres(filterableGames)}
          maxOwners={totalUsers}
        />
      </div>

      {games.length === 0 ? (
        <p className="text-sm text-muted">
          Aucun jeu ne correspond aux filtres actifs.
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
