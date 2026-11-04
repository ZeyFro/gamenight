export interface TeamGameOption { id: string; name: string }

function normalizedGameName(name: string): string {
  return name.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR");
}

/** Hide display duplicates; never alter game records or existing teams. */
export function uniqueTeamGameOptions(games: readonly TeamGameOption[]): TeamGameOption[] {
  const seen = new Set<string>();
  return games.filter((game) => {
    const key = normalizedGameName(game.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function filterTeamGameOptions(games: readonly TeamGameOption[], query: string): TeamGameOption[] {
  const normalized = normalizedGameName(query);
  if (!normalized) return [...games];
  return games.filter((game) => normalizedGameName(game.name).includes(normalized));
}
