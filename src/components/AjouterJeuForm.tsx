"use client";

import { useState } from "react";
import Image from "next/image";
import type { IgdbGameCandidate } from "@/lib/igdb";
import { addManualGame } from "@/app/actions";

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
    <form
      action={addManualGame}
      className="flex flex-col gap-5 rounded-2xl bg-white p-6 shadow-sm dark:bg-zinc-950"
    >
      {selected && (
        <>
          <input type="hidden" name="igdbId" value={selected.igdbId} />
          {selected.coverUrl && (
            <input type="hidden" name="coverUrl" value={selected.coverUrl} />
          )}
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Nom du jeu
        </label>
        <div className="flex gap-2">
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
            className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            onClick={rechercherSurIgdb}
            disabled={searching || name.trim().length < 2}
            className="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {searching ? "Recherche…" : "Chercher sur IGDB"}
          </button>
        </div>
        {searchError && (
          <p className="text-sm text-red-600 dark:text-red-400">{searchError}</p>
        )}
      </div>

      {results.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="text-sm text-zinc-500">Résultats IGDB — choisis une correspondance :</p>
          {results.map((r) => (
            <button
              key={r.igdbId}
              type="button"
              onClick={() => selectionner(r)}
              className="flex items-center gap-3 rounded-lg p-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900"
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
                <div className="h-11 w-8 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />
              )}
              <span className="text-sm">{r.name}</span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
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

      <div className="flex items-center gap-2">
        <input
          id="isCoop"
          name="isCoop"
          type="checkbox"
          checked={isCoop}
          onChange={(e) => setIsCoop(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-300"
        />
        <label htmlFor="isCoop" className="text-sm text-zinc-700 dark:text-zinc-300">
          Jouable en coop
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="minPlayers" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Joueurs minimum
          </label>
          <input
            id="minPlayers"
            name="minPlayers"
            type="number"
            min={1}
            value={minPlayers}
            onChange={(e) => setMinPlayers(Number(e.target.value))}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="maxPlayers" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Joueurs maximum
          </label>
          <input
            id="maxPlayers"
            name="maxPlayers"
            type="number"
            min={1}
            value={maxPlayers}
            onChange={(e) =>
              setMaxPlayers(e.target.value === "" ? "" : Number(e.target.value))
            }
            placeholder="Optionnel"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      </div>

      {!selected && (
        <p className="text-xs text-zinc-500">
          Pas de correspondance IGDB trouvée ou utile ? Laisse les champs
          ci-dessus tels quels (2 joueurs par défaut) ou ajuste-les à la main.
        </p>
      )}

      <button
        type="submit"
        className="self-start rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        Ajouter à ma bibliothèque
      </button>
    </form>
  );
}
