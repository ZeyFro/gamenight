"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { proposeGame } from "@/app/sessions/actions/proposals-votes";

interface ComboboxGame {
  id: string;
  name: string;
}

/**
 * Formulaire "Proposer un jeu" — combobox recherche + sélection à la place
 * du `<select>` natif d'origine, devenu pénible passé une grosse
 * quarantaine de jeux dans la biblio commune. Composant maison plutôt
 * qu'une lib dédiée (cmdk, cf. résumé de PR) : cohérent avec le reste de
 * l'app (aucun kit UI, primitives Tailwind faites main comme
 * `EditGameDialog`/`DeleteSessionDialog`), et l'interaction recherchée est
 * simple — filtrer une liste et choisir un item, pas de multi-select ni de
 * chargement async. Le bouton "Proposer" reste désactivé tant qu'aucun jeu
 * de la liste n'est sélectionné (pas de `required` sur un champ caché : ça
 * n'est pas fiable sur `type="hidden"`, cf. spec HTML).
 */
export function ProposeGameForm({
  sessionId,
  games,
}: {
  sessionId: string;
  games: ComboboxGame[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ComboboxGame | null>(null);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [isPending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return games;
    return games.filter((g) => g.name.toLowerCase().includes(q));
  }, [games, query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function select(game: ComboboxGame) {
    setSelected(game);
    setQuery(game.name);
    setOpen(false);
  }

  function handleChange(value: string) {
    setQuery(value);
    if (selected && value !== selected.name) setSelected(null);
    setOpen(true);
    setHighlighted(0);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const game = filtered[highlighted];
      if (game) select(game);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;

    const formData = new FormData();
    formData.set("sessionId", sessionId);
    formData.set("gameId", selected.id);

    startTransition(async () => {
      await proposeGame(formData);
      toast.success("Jeu proposé");
      setQuery("");
      setSelected(null);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div ref={rootRef} className="relative flex flex-1 flex-col gap-1">
        <label className="text-xs text-muted" htmlFor="propose-game-input">
          Jeu
        </label>
        <input
          id="propose-game-input"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Rechercher un jeu…"
          autoComplete="off"
          className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
        />

        {open && (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute top-full z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-2.5 text-sm text-muted">
                Aucun jeu trouvé.
              </li>
            )}
            {filtered.map((game, i) => (
              <li
                key={game.id}
                role="option"
                aria-selected={selected?.id === game.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(game);
                }}
                className={`flex min-h-11 cursor-pointer items-center px-3 py-2.5 text-base text-foreground ${
                  i === highlighted ? "bg-accent/10" : ""
                }`}
              >
                {game.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button
        type="submit"
        variant="primary"
        fullWidthOnMobile
        disabled={!selected || isPending}
      >
        Proposer
      </Button>
    </form>
  );
}
