import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getGroupLibraryGames, getGroupLibraryMembers, getGameOwnerCounts, getTotalUserCount, toFilterableGame } from "@/lib/game-library";
import { collectAvailableGenres, matchesGameFilters, parseGameFilters } from "@/lib/game-filters";
import { ButtonLink } from "@/components/ui/Button";
import { LibraryTabs } from "@/components/LibraryTabs";
import { GameFilterDrawer } from "@/components/GameFilterDrawer";
import { ReadOnlyGameGrid } from "@/components/ReadOnlyGameGrid";
import { pageMetadata } from "@/lib/page-title";
import Link from "next/link";

export const metadata = pageMetadata("Bibliothèque du groupe");

export default async function GroupLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const params = await searchParams;
  const selected = [...new Set(typeof params.participants === "string" ? [params.participants] : params.participants ?? [])];
  const [allGames, members, ownerCounts, totalUsers] = await Promise.all([
    getGroupLibraryGames(user.id, selected),
    getGroupLibraryMembers(user.id),
    getGameOwnerCounts(user.id),
    getTotalUserCount(user.id),
  ]);

  const filterableGames = allGames.map((game) => toFilterableGame(game));
  const filters = parseGameFilters(params);
  const validSelection = selected.length <= 100 && selected.every(id => members.some(member => member.id === id));
  const remainingParams = Object.entries(params).flatMap(([key, value]) =>
    key === "participants" || value === undefined ? [] : (Array.isArray(value) ? value : [value]).map(item => [key, item] as [string, string])
  );
  const resetSelectionUrl = `/bibliotheque/groupe?${new URLSearchParams(remainingParams).toString()}`;
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
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
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

      <form action="/bibliotheque/groupe" method="get" className="rounded-xl border border-border bg-surface p-4">
        {remainingParams.map(([key, value], index) => <input key={`${key}-${index}`} type="hidden" name={key} value={value} />)}
        <fieldset>
          <legend className="font-semibold">Jeux possédés par tous les participants choisis</legend>
          <p className="mt-1 text-sm text-muted">Coche les personnes qui joueront, toi compris si tu participes. Sans sélection, toute la bibliothèque du groupe apparaît. Jusqu’à 100 personnes.</p>
          <div className="my-3 grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
            {members.map(member => <label key={member.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="participants" value={member.id} defaultChecked={selected.includes(member.id)} />{member.discordName}
            </label>)}
          </div>
        </fieldset>
        {!validSelection && <p role="alert" className="mb-3 text-sm text-destructive">La sélection contient une personne inaccessible ou dépasse 100 personnes. Aucun résultat n’est affiché ; refais ta sélection.</p>}
        <div className="flex flex-wrap items-center gap-4">
          <button className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">Afficher les jeux communs</button>
          {selected.length > 0 && <Link href={resetSelectionUrl} className="text-sm text-accent hover:underline">Effacer la sélection</Link>}
        </div>
      </form>

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
        emptyMessage={selected.length > 0 ? "Aucun jeu possédé par toutes les personnes choisies ne correspond à la sélection et aux filtres." : "Personne n'a encore de jeu dans sa bibliothèque, ou aucun jeu ne correspond aux filtres."}
        sortByOwners
      />
    </div>
  );
}
