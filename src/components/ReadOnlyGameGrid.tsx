"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Stagger, StaggerItem } from "@/components/motion";

export interface ReadOnlyGameOwner {
  id: string;
  discordName: string;
  discordAvatar: string | null;
}

export interface ReadOnlyGame {
  id: string;
  name: string;
  coverUrl: string | null;
  source: string;
  isCoop: boolean;
  minPlayers: number | null;
  maxPlayers: number | null;
  // Renseigné uniquement pour la biblio de groupe (F : qui possède ce jeu).
  owners?: ReadOnlyGameOwner[];
}

const SOURCE_LABELS: Record<string, string> = {
  STEAM: "Steam",
  IGDB: "IGDB",
  MANUAL: "Manuel",
};

/**
 * Grille de jeux en lecture seule : biblio d'un pote, ou biblio de groupe
 * (avec avatars des possesseurs). Reprend le style + filtre de
 * `BibliothequeGrid` mais sans les actions d'édition/retrait.
 */
export function ReadOnlyGameGrid({
  games,
  emptyMessage,
  sortByOwners = false,
}: {
  games: ReadOnlyGame[];
  emptyMessage: string;
  sortByOwners?: boolean;
}) {
  const [filter, setFilter] = useState("");

  const sorted = useMemo(() => {
    if (!sortByOwners) return games;
    return [...games].sort(
      (a, b) => (b.owners?.length ?? 0) - (a.owners?.length ?? 0)
    );
  }, [games, sortByOwners]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((game) => game.name.toLowerCase().includes(q));
  }, [sorted, filter]);

  if (games.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">{emptyMessage}</p>
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
        aria-label="Filtrer par nom"
        className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
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
              <ReadOnlyGameCard game={game} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}

function ReadOnlyGameCard({ game }: { game: ReadOnlyGame }) {
  const owners = game.owners ?? [];

  return (
    <Link
      href={`/jeux/${game.id}`}
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition-all duration-200 hover:card-glow">
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
        {owners.length > 0 && (
          <div className="absolute bottom-1.5 left-1.5 flex -space-x-2">
            {owners.slice(0, 4).map((owner) => (
              <Avatar
                key={owner.id}
                src={owner.discordAvatar}
                alt={owner.discordName}
                size={26}
                className="border-2 border-surface"
              />
            ))}
            {owners.length > 4 && (
              <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 border-surface bg-black/70 text-[10px] font-semibold text-white">
                +{owners.length - 4}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="text-sm font-medium text-foreground">{game.name}</p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <Badge>{SOURCE_LABELS[game.source] ?? game.source}</Badge>
          {(game.minPlayers || game.maxPlayers) && (
            <span>
              {game.minPlayers ?? "?"}–{game.maxPlayers ?? "?"} joueurs
            </span>
          )}
          {game.isCoop && <span>· coop</span>}
        </div>
        {owners.length > 0 && (
          <p className="text-xs text-muted">
            {owners.length} pote{owners.length > 1 ? "s" : ""} :{" "}
            {owners.map((o) => o.discordName).join(", ")}
          </p>
        )}
      </div>
    </Link>
  );
}
