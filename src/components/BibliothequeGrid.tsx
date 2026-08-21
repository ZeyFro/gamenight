"use client";

import { useMemo, useState } from "react";
import type { SVGProps } from "react";
import Image from "next/image";
import { removeUserGame } from "@/app/actions";

export interface BibliothequeGame {
  id: string;
  name: string;
  coverUrl: string | null;
  source: string;
  isCoop: boolean;
  minPlayers: number | null;
  maxPlayers: number | null;
}

const SOURCE_LABELS: Record<string, string> = {
  STEAM: "Steam",
  IGDB: "IGDB",
  MANUAL: "Manuel",
};

export function BibliothequeGrid({ games }: { games: BibliothequeGame[] }) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return games;
    return games.filter((game) => game.name.toLowerCase().includes(q));
  }, [games, filter]);

  if (games.length === 0) {
    return (
      <p className="rounded-2xl bg-white p-6 text-sm text-zinc-600 shadow-sm dark:bg-zinc-950 dark:text-zinc-400">
        Ta bibliothèque est vide pour l&apos;instant. Lie ton compte Steam
        depuis ton profil pour importer tes jeux, ou ajoute-en un
        manuellement.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filtrer par nom…"
        aria-label="Filtrer la bibliothèque par nom"
        className="w-full rounded-lg border border-zinc-300 px-4 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
      />

      {filtered.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-sm text-zinc-600 shadow-sm dark:bg-zinc-950 dark:text-zinc-400">
          Aucun jeu ne correspond à « {filter} ».
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4">
          {filtered.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      )}
    </div>
  );
}

function GameCard({ game }: { game: BibliothequeGame }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl bg-white shadow-sm dark:bg-zinc-950">
      <div className="relative aspect-[2/3] w-full bg-zinc-200 dark:bg-zinc-800">
        {game.coverUrl && (
          <Image
            src={game.coverUrl}
            alt={game.name}
            fill
            sizes="(max-width: 640px) 50vw, 25vw"
            className="object-cover"
          />
        )}
        <form action={removeUserGame} className="absolute top-1.5 right-1.5">
          <input type="hidden" name="gameId" value={game.id} />
          <button
            type="submit"
            aria-label={`Retirer ${game.name} de ma bibliothèque`}
            title="Retirer de ma bibliothèque"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-red-600/90 active:bg-red-600"
          >
            <TrashIcon className="h-5 w-5" />
          </button>
        </form>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
          {game.name}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-900">
            {SOURCE_LABELS[game.source] ?? game.source}
          </span>
          {(game.minPlayers || game.maxPlayers) && (
            <span>
              {game.minPlayers ?? "?"}–{game.maxPlayers ?? "?"} joueurs
            </span>
          )}
          {game.isCoop && <span>· coop</span>}
        </div>
      </div>
    </div>
  );
}

function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" {...props}>
      <path
        fillRule="evenodd"
        d="M8.75 1a.75.75 0 0 0-.75.75V2h-3a.75.75 0 0 0 0 1.5h.32l.83 11.6A2 2 0 0 0 8.14 17h3.72a2 2 0 0 0 1.99-1.9l.83-11.6h.32a.75.75 0 0 0 0-1.5h-3v-.25a.75.75 0 0 0-.75-.75h-2.5ZM7.6 3.5h4.8l-.82 11.5a.5.5 0 0 1-.5.46H8.92a.5.5 0 0 1-.5-.46L7.6 3.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
