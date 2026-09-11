"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { IgdbGameCandidate } from "@/lib/igdb";
import { Button } from "@/components/ui/Button";
import { ApiErrorBanner } from "@/components/ApiErrorBanner";
import { proposeWishlistGameAction } from "@/app/wishlist/actions";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Fix (Sprint 5 suite) — recherche IGDB (pas un select limité à la
 * biblio du groupe, cf. `proposeWishlistGameAction`) : autocomplete
 * débouncée (300ms), même endpoint `/api/igdb/search` que
 * `AjouterJeuForm`. Permet de proposer un jeu que personne dans le
 * groupe ne possède encore (ex. un jeu pas encore sorti).
 */
export function WishlistProposeForm() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<IgdbGameCandidate[]>([]);
  const [selected, setSelected] = useState<IgdbGameCandidate | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function search(term: string) {
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/igdb/search?q=${encodeURIComponent(term.trim())}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { results: IgdbGameCandidate[] };
      setResults(data.results);
    } catch {
      setSearchError("La recherche IGDB a échoué.");
    } finally {
      setSearching(false);
    }
  }

  function handleChange(value: string) {
    setQuery(value);
    setSelected(null);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => search(value), SEARCH_DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  function select(candidate: IgdbGameCandidate) {
    setSelected(candidate);
    setQuery(candidate.name);
    setResults([]);
  }

  return (
    <form action={proposeWishlistGameAction} className="flex flex-col gap-3">
      <p className="text-sm font-medium text-foreground">Proposer un jeu</p>

      {selected && (
        <>
          <input type="hidden" name="igdbId" value={selected.igdbId} />
          <input type="hidden" name="name" value={selected.name} />
          {selected.coverUrl && (
            <input type="hidden" name="coverUrl" value={selected.coverUrl} />
          )}
        </>
      )}

      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Rechercher un jeu sur IGDB…"
          autoComplete="off"
          className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        {searching && (
          <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-faint">
            Recherche…
          </span>
        )}

        {results.length > 0 && (
          <div className="absolute top-full z-10 mt-1 flex w-full flex-col gap-1 rounded-lg border border-border bg-surface p-2 shadow-lg">
            {results.map((r) => (
              <button
                key={r.igdbId}
                type="button"
                onClick={() => select(r)}
                className="flex items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-surface-hover"
              >
                {r.coverUrl ? (
                  <Image
                    src={r.coverUrl}
                    alt=""
                    width={32}
                    height={44}
                    className="rounded object-cover"
                  />
                ) : (
                  <div className="h-11 w-8 shrink-0 rounded bg-surface-hover" />
                )}
                <span className="text-sm text-foreground">{r.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {searchError && <ApiErrorBanner message={searchError} onRetry={() => search(query)} />}

      {selected && (
        <div className="flex items-center gap-3 rounded-lg border border-accent/40 bg-accent/10 p-2">
          {selected.coverUrl && (
            <Image
              src={selected.coverUrl}
              alt=""
              width={28}
              height={38}
              className="rounded object-cover"
            />
          )}
          <span className="text-sm text-accent">{selected.name} sélectionné</span>
        </div>
      )}

      <input
        type="text"
        name="reason"
        maxLength={200}
        placeholder="Pourquoi ce jeu ? (optionnel)"
        className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />

      <Button type="submit" variant="primary" fullWidthOnMobile disabled={!selected}>
        Proposer
      </Button>
    </form>
  );
}
