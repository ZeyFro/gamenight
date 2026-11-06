"use client";

import { useMemo, useState } from "react";
import { filterTeamGameOptions, uniqueTeamGameOptions, type TeamGameOption } from "./game-picker-rules";

/** Searchable form field; duplicate labels are hidden without deleting records. */
export function GamePicker({ games }: { games: TeamGameOption[] }) {
  const [query, setQuery] = useState("");
  const [gameId, setGameId] = useState("");
  const choices = useMemo(() => uniqueTeamGameOptions(games), [games]);
  const filtered = useMemo(() => filterTeamGameOptions(choices, query), [choices, query]);
  const selected = filtered.some((game) => game.id === gameId) ? gameId : "";

  return (
    <div className="grid gap-2">
      <label htmlFor="team-game-search" className="text-sm text-foreground">Rechercher un jeu</label>
      <input
        id="team-game-search"
        type="search"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setGameId(""); }}
        placeholder="Ex. Minecraft, Valheim…"
        autoComplete="off"
        className="rounded-lg border border-border bg-background px-3 py-3 text-base"
      />
      <label htmlFor="team-game-id" className="text-sm text-foreground">Jeu</label>
      <select
        id="team-game-id"
        name="gameId"
        required
        value={selected}
        onChange={(event) => setGameId(event.target.value)}
        className="rounded-lg border border-border bg-background px-3 py-3 text-base"
      >
        <option value="">Choisir un jeu</option>
        {filtered.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
      </select>
      <p className="text-xs text-muted" role="status">
        {filtered.length === 0 ? "Aucun jeu trouvé. Essaie un autre terme." :
          `${filtered.length} jeu${filtered.length > 1 ? "x" : ""} disponible${filtered.length > 1 ? "s" : ""}.`}
      </p>
    </div>
  );
}
