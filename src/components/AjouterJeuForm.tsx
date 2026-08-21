"use client";

import { useState } from "react";
import Image from "next/image";
import type { IgdbGameCandidate } from "@/lib/igdb";
import { addManualGame } from "@/app/actions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export function AjouterJeuForm() {
  const [name, setName] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<IgdbGameCandidate[]>([]);
  const [selected, setSelected] = useState<IgdbGameCandidate | null>(null);
  const [isCoop, setIsCoop] = useState(false);
  const [minPlayers, setMinPlayers] = useState(2);
  const [maxPlayers, setMaxPlayers] = useState<number | "">("");

  async function rechercherSurIgdb() {
    if (name.trim().length < 2) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `/api/igdb/search?q=${encodeURIComponent(name.trim())}`
      );
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { results: IgdbGameCandidate[] };
      setResults(data.results);
    } catch {
      setSearchError("La recherche IGDB a échoué. Réessaie ou saisis à la main.");
    } finally {
      setSearching(false);
    }
  }

  function selectionner(candidat: IgdbGameCandidate) {
    setSelected(candidat);
    setName(candidat.name);
    setIsCoop(candidat.isCoop);
    setMinPlayers(candidat.minPlayers ?? 2);
    setMaxPlayers(candidat.maxPlayers ?? "");
    setResults([]);
  }

  function saisieManuelle() {
    setSelected(null);
  }

  return (
    <Card className="p-4 sm:p-6">
      <form action={addManualGame} className="flex flex-col gap-5">
        {selected && (
          <>
            <input type="hidden" name="igdbId" value={selected.igdbId} />
            {selected.coverUrl && (
              <input type="hidden" name="coverUrl" value={selected.coverUrl} />
            )}
          </>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-sm font-medium text-foreground">
            Nom du jeu
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="name"
              name="name"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSelected(null);
              }}
              placeholder="ex. Minecraft, Valheim, ATM11…"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={rechercherSurIgdb}
              disabled={searching || name.trim().length < 2}
              className="shrink-0 rounded-lg border border-border px-4 py-3 text-base font-medium text-foreground transition-colors hover:border-border-hover hover:bg-surface-hover disabled:opacity-50 sm:text-sm"
            >
              {searching ? "Recherche…" : "Chercher sur IGDB"}
            </button>
          </div>
          {searchError && (
            <p className="text-sm text-destructive">{searchError}</p>
          )}
        </div>

        {results.length > 0 && (
          <div className="flex flex-col gap-1 rounded-lg border border-border p-2">
            <p className="px-1 py-1 text-sm text-muted">
              Résultats IGDB — choisis une correspondance :
            </p>
            {results.map((r) => (
              <button
                key={r.igdbId}
                type="button"
                onClick={() => selectionner(r)}
                className="flex items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-surface-hover"
              >
                {r.coverUrl ? (
                  <Image
                    src={r.coverUrl}
                    alt=""
                    width={36}
                    height={48}
                    className="rounded object-cover"
                  />
                ) : (
                  <div className="h-12 w-9 shrink-0 rounded bg-surface-hover" />
                )}
                <span className="text-base sm:text-sm">{r.name}</span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <p className="text-sm text-accent">
            Correspondance IGDB sélectionnée.{" "}
            <button
              type="button"
              onClick={saisieManuelle}
              className="underline underline-offset-2"
            >
              Revenir à la saisie manuelle
            </button>
          </p>
        )}

        <label
          htmlFor="isCoop"
          className="flex items-center gap-3 py-1 text-base text-foreground sm:text-sm"
        >
          <input
            id="isCoop"
            name="isCoop"
            type="checkbox"
            checked={isCoop}
            onChange={(e) => setIsCoop(e.target.checked)}
            className="h-5 w-5 rounded border-border accent-accent"
          />
          Jouable en coop
        </label>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="minPlayers" className="text-sm font-medium text-foreground">
              Joueurs minimum
            </label>
            <input
              id="minPlayers"
              name="minPlayers"
              type="number"
              min={1}
              max={100}
              required
              value={minPlayers}
              onChange={(e) => setMinPlayers(Number(e.target.value))}
              className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="maxPlayers" className="text-sm font-medium text-foreground">
              Joueurs maximum
            </label>
            <input
              id="maxPlayers"
              name="maxPlayers"
              type="number"
              min={minPlayers}
              max={100}
              value={maxPlayers}
              onChange={(e) =>
                setMaxPlayers(e.target.value === "" ? "" : Number(e.target.value))
              }
              placeholder="Optionnel"
              className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
            />
          </div>
        </div>
        <p className="text-xs text-faint">
          Entre 1 et 100 joueurs ; le maximum, si renseigné, doit être ≥ au
          minimum.
        </p>

        {!selected && (
          <p className="text-xs text-muted">
            Pas de correspondance IGDB trouvée ou utile ? Laisse les champs
            ci-dessus tels quels (2 joueurs par défaut) ou ajuste-les à la main.
          </p>
        )}

        <Button type="submit" variant="primary" fullWidthOnMobile>
          Ajouter à ma bibliothèque
        </Button>
      </form>
    </Card>
  );
}
