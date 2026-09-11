"use client";

import { useMemo, useState } from "react";
import type { SVGProps } from "react";
import Link from "next/link";
import Image from "next/image";
import { removeUserGame, toggleGameCoop } from "@/app/actions";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Stagger, StaggerItem } from "@/components/motion";
import { EditGameDialog } from "@/components/EditGameDialog";

export interface BibliothequeGame {
  id: string;
  name: string;
  coverUrl: string | null;
  source: string;
  isCoop: boolean;
  minPlayers: number | null;
  maxPlayers: number | null;
  /** Comment CE user possède ce jeu (PERSONAL/FAMILY/MANUAL) — badge "Familial" si FAMILY. */
  ownershipSource?: string;
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
      <Card>
        <p className="text-sm text-muted">
          Ta bibliothèque est vide pour l&apos;instant. Lie ton compte Steam
          depuis ton profil pour importer tes jeux, ou ajoute-en un
          manuellement.
        </p>
      </Card>
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
        className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />

      {filtered.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Aucun jeu ne correspond à « {filter} ».
          </p>
        </Card>
      ) : (
        <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4">
          {filtered.map((game) => (
            <StaggerItem key={game.id}>
              <GameCard game={game} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}

function GameCard({ game }: { game: BibliothequeGame }) {
  return (
    <div className="card-glow relative flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition-all duration-200">
      <Link href={`/jeux/${game.id}`} className="flex flex-1 flex-col">
        <div className="relative aspect-[2/3] w-full bg-surface-hover">
          {game.coverUrl && (
            <Image
              src={game.coverUrl}
              alt={game.name}
              fill
              sizes="(max-width: 640px) 50vw, 25vw"
              className="object-cover"
            />
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-3 pb-1">
          <p className="text-sm font-medium text-foreground">{game.name}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <Badge>{SOURCE_LABELS[game.source] ?? game.source}</Badge>
            {game.ownershipSource === "FAMILY" && (
              <Badge tone="accent">👨‍👩‍👧 Familial</Badge>
            )}
            {(game.minPlayers || game.maxPlayers) && (
              <span>
                {game.minPlayers ?? "?"}–{game.maxPlayers ?? "?"} joueurs
              </span>
            )}
            {game.isCoop && <span>· coop</span>}
          </div>
        </div>
      </Link>
      {/* Hors du <Link> exprès (Bug 2C, PR 32) : un <button> dans un <a>
          est invalide en HTML et déclencherait la navigation en plus du
          toggle au clic. */}
      <form action={toggleGameCoop} className="px-3 pb-2">
        <input type="hidden" name="gameId" value={game.id} />
        <button
          type="submit"
          className="text-[11px] text-muted underline decoration-dotted hover:text-foreground"
        >
          {game.isCoop ? "Retirer coop" : "Marquer comme coop"}
        </button>
      </form>
      <div className="absolute top-1.5 right-1.5 flex gap-1.5">
        <EditGameDialog game={game} />
        <form action={removeUserGame}>
          <input type="hidden" name="gameId" value={game.id} />
          <button
            type="submit"
            aria-label={`Retirer ${game.name} de ma bibliothèque`}
            title="Retirer de ma bibliothèque"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-destructive/90 active:bg-destructive"
          >
            <TrashIcon className="h-5 w-5" />
          </button>
        </form>
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
