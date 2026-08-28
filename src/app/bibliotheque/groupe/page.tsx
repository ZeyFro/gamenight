import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getGameOwnerCounts, getTotalUserCount, toFilterableGame } from "@/lib/game-library";
import { collectAvailableGenres, matchesGameFilters, parseGameFilters } from "@/lib/game-filters";
import { ButtonLink } from "@/components/ui/Button";
import { LibraryTabs } from "@/components/LibraryTabs";
import { GameFilterDrawer } from "@/components/GameFilterDrawer";
import { ReadOnlyGameGrid } from "@/components/ReadOnlyGameGrid";

export default async function GroupLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const [allGames, ownerCounts, totalUsers] = await Promise.all([
    prisma.game.findMany({
      where: { userGames: { some: { owned: true } } },
      include: {
        userGames: {
          where: { owned: true },
          include: { user: true },
        },
      },
    }),
    getGameOwnerCounts(),
    getTotalUserCount(),
  ]);

  const filterableGames = allGames.map((game) => toFilterableGame(game));
  const filters = parseGameFilters(await searchParams);
  const filteredGames = allGames.filter((game, index) =>
    matchesGameFilters(filterableGames[index], ownerCounts.get(game.id) ?? 0, filters)
  );

  const mapped = filteredGames.map((game) => ({
    id: game.id,
    name: game.name,
    coverUrl: game.coverUrl,
    source: game.source,
    isCoop: game.isCoop,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    owners: game.userGames.map((ug) => ({
      id: ug.user.id,
      discordName: ug.user.discordName,
      discordAvatar: ug.user.discordAvatar,
    })),
  }));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
          Bibliothèque du groupe
        </h1>
        <ButtonLink
          href="/bibliotheque/ajouter"
          variant="primary"
          fullWidthOnMobile
        >
          + Ajouter un jeu
        </ButtonLink>
      </div>

      <LibraryTabs active="groupe" />

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {mapped.length} jeu{mapped.length === 1 ? "" : "x"}
          {filteredGames.length !== allGames.length && ` sur ${allGames.length}`}
        </p>
        <GameFilterDrawer
          availableGenres={collectAvailableGenres(filterableGames)}
          maxOwners={totalUsers}
        />
      </div>

      <ReadOnlyGameGrid
        games={mapped}
        emptyMessage="Personne n'a encore de jeu dans sa bibliothèque."
        sortByOwners
      />
    </div>
  );
}
