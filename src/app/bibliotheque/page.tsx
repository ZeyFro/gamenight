import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { getGameOwnerCounts, getTotalUserCount, toFilterableGame } from "@/lib/game-library";
import { collectAvailableGenres, matchesGameFilters, parseGameFilters } from "@/lib/game-filters";
import { BibliothequeGrid } from "@/components/BibliothequeGrid";
import { LibraryTabs } from "@/components/LibraryTabs";
import { GameFilterDrawer } from "@/components/GameFilterDrawer";
import { CoopEnrichmentTrigger } from "@/components/CoopEnrichmentTrigger";
import { MarkAllCoopButton } from "@/components/MarkAllCoopButton";
import { ButtonLink } from "@/components/ui/Button";

export default async function BibliothequePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const [userGames, ownerCounts, totalUsers] = await Promise.all([
    prisma.userGame.findMany({
      where: { userId: user.id, owned: true },
      include: { game: true },
      orderBy: { game: { name: "asc" } },
    }),
    getGameOwnerCounts(),
    getTotalUserCount(),
  ]);

  const allGames = userGames.map(({ game }) => game);
  const filterableGames = allGames.map(toFilterableGame);
  const filters = parseGameFilters(await searchParams);
  const filteredGames = allGames.filter((game, index) =>
    matchesGameFilters(filterableGames[index], ownerCounts.get(game.id) ?? 0, filters)
  );

  const gamesNeedingEnrichment = allGames
    .filter((game) => !game.igdbDetails)
    .map((game) => game.id);

  // PR 32.6, Bloc B — jeux pas encore vérifiés (ni backfill Steam/IGDB
  // concluant, ni confirmation humaine), affiché en badge sur l'onglet
  // "À vérifier".
  const toVerifyCount = allGames.filter(
    (game) => !game.isCoop && !game.playInfoManual
  ).length;

  // Bonus Bloc B : quand le filtre "Coop" est le SEUL filtre de mode
  // actif, la liste affichée est déjà entièrement coop — proposer de
  // confirmer ces jeux d'un coup (`playInfoManual: true`) pour les
  // protéger du prochain backfill automatique.
  const onlyCoopFilterActive =
    filters.modes.length === 1 && filters.modes[0] === "coop";
  const visibleCoopGameIds = onlyCoopFilterActive
    ? filteredGames.map((game) => game.id)
    : [];

  const games = filteredGames.map((game) => ({
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

      <LibraryTabs active="perso" toVerifyCount={toVerifyCount} />

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {games.length} jeu{games.length === 1 ? "" : "x"}
          {filteredGames.length !== allGames.length && ` sur ${allGames.length}`}
        </p>
        <GameFilterDrawer
          availableGenres={collectAvailableGenres(filterableGames)}
          maxOwners={totalUsers}
        />
      </div>

      {onlyCoopFilterActive && <MarkAllCoopButton gameIds={visibleCoopGameIds} />}

      <CoopEnrichmentTrigger
        active={filters.modes.includes("coop")}
        gameIds={gamesNeedingEnrichment}
      />

      <BibliothequeGrid games={games} />
    </div>
  );
}
