"use client";

import { useState } from "react";
import { submitRouletteEntriesAction } from "@/app/roulette/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { haptics } from "@/lib/haptics";

export interface RouletteGame {
  id: string;
  name: string;
  coverUrl: string | null;
}

const GAMES_PER_PARTICIPANT = 2;

/**
 * Formulaire "propose tes 2 jeux" sur `/roulette/[id]` — même logique de
 * recherche/sélection que `ParticipantGamesCard` (`RouletteWizard`, mode
 * instant), mais scopé à la seule bibliothèque de l'utilisateur courant
 * (jamais celle des autres, pas de créateur qui choisit "pour" quelqu'un
 * ici — chacun propose pour soi, c'est tout le principe du mode async).
 * Pré-rempli avec `initialSelection` si l'utilisateur a déjà proposé —
 * soumettre à nouveau REMPLACE ses jeux (`submitRouletteEntriesAction`
 * fait un delete+recreate), donc "changer d'avis" avant la deadline
 * fonctionne naturellement en resoumettant ce même formulaire.
 */
export function RouletteEntryForm({
  rouletteId,
  myGames,
  initialSelection,
}: {
  rouletteId: string;
  myGames: RouletteGame[];
  initialSelection: RouletteGame[];
}) {
  const [selected, setSelected] = useState<RouletteGame[]>(initialSelection);
  const [query, setQuery] = useState("");
  const full = selected.length >= GAMES_PER_PARTICIPANT;
  const alreadyProposed = initialSelection.length === GAMES_PER_PARTICIPANT;

  const filtered = myGames
    .filter((g) => !selected.some((s) => s.id === g.id))
    .filter((g) => g.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 8);

  function addGame(game: RouletteGame) {
    haptics.light();
    setSelected((prev) => (prev.length >= GAMES_PER_PARTICIPANT ? prev : [...prev, game]));
    setQuery("");
  }

  function removeGame(gameId: string) {
    setSelected((prev) => prev.filter((g) => g.id !== gameId));
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Tes 2 jeux</p>
        <span className="text-xs text-muted">
          {selected.length}/{GAMES_PER_PARTICIPANT}
        </span>
      </div>

      {alreadyProposed && (
        <p className="text-sm text-accent">✅ Tes jeux sont enregistrés</p>
      )}

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((g) => (
            <span
              key={g.id}
              className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 py-1 pr-1 pl-2 text-xs text-foreground"
            >
              {g.name}
              <button
                type="button"
                onClick={() => removeGame(g.id)}
                aria-label={`Retirer ${g.name}`}
                className="flex h-5 w-5 items-center justify-center rounded-full text-muted hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {!full && (
        <div className="flex flex-col gap-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un jeu de ta biblio…"
            className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
          {query && (
            <ul className="flex max-h-40 flex-col overflow-y-auto rounded-lg border border-border bg-surface">
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted">Aucun jeu trouvé.</li>
              )}
              {filtered.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => addGame(g)}
                    className="flex w-full items-center px-3 py-2 text-left text-sm text-foreground hover:bg-surface-hover"
                  >
                    {g.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {myGames.length === 0 && (
        <p className="text-xs text-muted">Aucun jeu dans ta bibliothèque.</p>
      )}

      <form action={submitRouletteEntriesAction}>
        <input type="hidden" name="rouletteId" value={rouletteId} />
        {selected.map((g) => (
          <input key={g.id} type="hidden" name="gameId" value={g.id} />
        ))}
        <Button
          type="submit"
          variant="primary"
          fullWidthOnMobile
          disabled={selected.length !== GAMES_PER_PARTICIPANT}
        >
          {alreadyProposed ? "Mettre à jour mes jeux" : "Valider mes jeux"}
        </Button>
      </form>
    </Card>
  );
}
