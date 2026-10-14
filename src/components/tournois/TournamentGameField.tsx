"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import Image from "next/image";
import type { IgdbGameCandidate } from "@/lib/igdb";
import { filterLocalGames, excludeLocalIgdbIds, type LocalGameOption } from "@/lib/game-search";
import { resolveIgdbGameAction } from "@/app/actions";
import { ApiErrorBanner } from "@/components/ApiErrorBanner";

const IGDB_SEARCH_DEBOUNCE_MS = 300;
const IGDB_SEARCH_MIN_LENGTH = 2;

export interface SelectedGame {
  id: string;
  name: string;
}

/**
 * Sélecteur de jeu — création de tournoi. Remplace le `<select>` natif de
 * `/tournois/creer` (biblio commune complète, pénible à parcourir au-delà
 * d'une grosse quarantaine de jeux). Deux sources combinées dans une seule
 * combobox, sur le même modèle d'interaction que `ProposeGameForm`
 * (input `role="combobox"` + `listbox`, navigation clavier, fermeture au
 * clic extérieur) :
 *
 * - jeux déjà dans l'appli (`localGames`, passés en prop) — filtrage
 *   local instantané, insensible casse/accents (`filterLocalGames`) ;
 * - résultats IGDB (mêmes endpoint/composant candidat que `AjouterJeuForm`/
 *   `WishlistProposeForm`, `/api/igdb/search`) — débouncés (300ms, à
 *   partir de 2 caractères), avec protection anti-race : un compteur de
 *   requête (`searchSeqRef`) garantit qu'une réponse qui arrive après une
 *   recherche plus récente est silencieusement ignorée plutôt que
 *   d'écraser son résultat.
 *
 * Sélectionner un jeu déjà présent localement ne fait AUCUN appel réseau
 * (son `id` est déjà connu). Sélectionner un résultat IGDB déclenche
 * `resolveIgdbGameAction` — upsert minimal côté serveur (par `igdbId`,
 * jamais de doublon) — pour obtenir un `gameId` réel : c'est le SEUL
 * moment où un jeu IGDB est écrit en base, jamais simplement parce qu'il
 * apparaît dans les résultats de recherche.
 */
export function TournamentGameField({
  localGames,
  selected,
  onSelectedChange,
}: {
  localGames: LocalGameOption[];
  selected: SelectedGame | null;
  onSelectedChange: (game: SelectedGame | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [igdbResults, setIgdbResults] = useState<IgdbGameCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [resolvingIgdbId, setResolvingIgdbId] = useState<number | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [, startResolveTransition] = useTransition();

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Protection anti-race : incrémenté à chaque recherche lancée, une
  // réponse dont le numéro ne correspond plus au dernier lancé est
  // obsolète et ignorée — une recherche plus ancienne ne peut jamais
  // écraser le résultat d'une recherche plus récente.
  const searchSeqRef = useRef(0);
  const listboxId = useId();

  const localMatches = useMemo(() => filterLocalGames(localGames, query), [localGames, query]);
  const localIgdbIds = useMemo(
    () => new Set(localGames.map((g) => g.igdbId).filter((id): id is number => id !== null)),
    [localGames]
  );
  const igdbResultsToShow = useMemo(
    () => excludeLocalIgdbIds(igdbResults, localIgdbIds),
    [igdbResults, localIgdbIds]
  );

  async function runIgdbSearch(term: string) {
    const trimmed = term.trim();
    if (trimmed.length < IGDB_SEARCH_MIN_LENGTH) {
      setIgdbResults([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeqRef.current;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/igdb/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { results: IgdbGameCandidate[] };
      if (seq !== searchSeqRef.current) return; // réponse obsolète, une recherche plus récente est en cours
      setIgdbResults(data.results);
    } catch {
      if (seq !== searchSeqRef.current) return;
      setSearchError("La recherche IGDB a échoué. Les jeux déjà dans l'appli restent utilisables.");
      setIgdbResults([]);
    } finally {
      if (seq === searchSeqRef.current) setSearching(false);
    }
  }

  function handleChange(value: string) {
    setQuery(value);
    if (selected && value !== selected.name) onSelectedChange(null);
    setOpen(true);
    setHighlighted(0);
    setResolveError(null);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => runIgdbSearch(value), IGDB_SEARCH_DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function selectLocal(game: LocalGameOption) {
    onSelectedChange({ id: game.id, name: game.name });
    setQuery(game.name);
    setOpen(false);
    setResolveError(null);
  }

  function selectIgdb(candidate: IgdbGameCandidate) {
    setResolvingIgdbId(candidate.igdbId);
    setResolveError(null);
    startResolveTransition(async () => {
      const formData = new FormData();
      formData.set("igdbId", String(candidate.igdbId));
      formData.set("name", candidate.name);
      if (candidate.coverUrl) formData.set("coverUrl", candidate.coverUrl);

      const result = await resolveIgdbGameAction(formData);
      setResolvingIgdbId(null);
      if (!result.ok || !result.gameId || !result.gameName) {
        setResolveError("Impossible d'ajouter ce jeu pour le moment. Réessaie ou choisis un autre jeu.");
        return;
      }
      onSelectedChange({ id: result.gameId, name: result.gameName });
      setQuery(result.gameName);
      setOpen(false);
    });
  }

  function clearSelection() {
    onSelectedChange(null);
    setQuery("");
    setResolveError(null);
    inputRef.current?.focus();
    setOpen(true);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const total = localMatches.length + igdbResultsToShow.length;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, Math.max(total - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlighted < localMatches.length) {
        const game = localMatches[highlighted];
        if (game) selectLocal(game);
      } else {
        const candidate = igdbResultsToShow[highlighted - localMatches.length];
        if (candidate) selectIgdb(candidate);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const noResults =
    !searching &&
    query.trim().length >= IGDB_SEARCH_MIN_LENGTH &&
    localMatches.length === 0 &&
    igdbResultsToShow.length === 0 &&
    !searchError;

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name="gameId" value={selected?.id ?? ""} />

      {selected ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-3">
          <span className="text-base text-accent sm:text-sm">🎮 {selected.name}</span>
          <button
            type="button"
            onClick={clearSelection}
            className="shrink-0 text-sm font-medium text-accent underline underline-offset-2"
          >
            Changer
          </button>
        </div>
      ) : (
        <div ref={rootRef} className="relative flex flex-col gap-1">
          <label className="text-xs text-muted" htmlFor="tournament-game-input">
            Jeu
          </label>
          <input
            id="tournament-game-input"
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Rechercher un jeu (ex. Minecraft, Splatoon…)"
            autoComplete="off"
            className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
          {searching && (
            <span className="absolute top-9 right-3 text-xs text-faint">Recherche…</span>
          )}

          {open && (
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Jeux correspondants"
              className="absolute top-full z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg"
            >
              {noResults && (
                <li className="px-3 py-2.5 text-sm text-muted">
                  Aucun jeu trouvé, ni dans l&apos;appli ni sur IGDB.
                </li>
              )}

              {localMatches.length > 0 && (
                <li role="presentation" aria-hidden className="px-3 pt-2 pb-1 text-xs font-medium text-faint">
                  Dans l&apos;application
                </li>
              )}
              {localMatches.map((game, i) => (
                <li
                  key={game.id}
                  role="option"
                  aria-selected={i === highlighted}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectLocal(game);
                  }}
                  className={`flex min-h-11 cursor-pointer items-center px-3 py-2.5 text-base text-foreground ${
                    i === highlighted ? "bg-accent/10" : ""
                  }`}
                >
                  {game.name}
                </li>
              ))}

              {igdbResultsToShow.length > 0 && (
                <li role="presentation" aria-hidden className="px-3 pt-2 pb-1 text-xs font-medium text-faint">
                  Résultats IGDB
                </li>
              )}
              {igdbResultsToShow.map((candidate, j) => {
                const idx = localMatches.length + j;
                const isResolving = resolvingIgdbId === candidate.igdbId;
                return (
                  <li
                    key={candidate.igdbId}
                    role="option"
                    aria-selected={idx === highlighted}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (!isResolving) selectIgdb(candidate);
                    }}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2.5 text-base text-foreground ${
                      idx === highlighted ? "bg-accent/10" : ""
                    } ${isResolving ? "opacity-60" : ""}`}
                  >
                    {candidate.coverUrl ? (
                      <Image
                        src={candidate.coverUrl}
                        alt=""
                        width={28}
                        height={38}
                        className="rounded object-cover"
                      />
                    ) : (
                      <div className="h-[38px] w-[28px] shrink-0 rounded bg-surface-hover" />
                    )}
                    <span className="flex-1">{candidate.name}</span>
                    {isResolving && <span className="text-xs text-faint">Ajout…</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {searchError && <ApiErrorBanner message={searchError} onRetry={() => runIgdbSearch(query)} />}
      {resolveError && <ApiErrorBanner message={resolveError} />}
    </div>
  );
}
