"use client";

import { useState, useTransition, type CSSProperties } from "react";
import Image from "next/image";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Tier } from "@prisma/client";
import { TIER_INTENSITY_CLASSES, TIER_ORDER } from "@/lib/tierlist";
import { setGameTierAction } from "@/app/tierlist/actions";

export interface TierlistGame {
  id: string;
  name: string;
  coverUrl: string | null;
}

const UNRANKED_ID = "unranked";

function GameCover({
  game,
  size = 56,
  className = "",
}: {
  game: TierlistGame;
  size?: number;
  className?: string;
}) {
  return (
    <div
      style={{ width: size, height: size }}
      title={game.name}
      className={`relative shrink-0 overflow-hidden rounded-lg border border-border bg-background ${className}`}
    >
      {game.coverUrl ? (
        <Image
          src={game.coverUrl}
          alt={game.name}
          fill
          sizes={`${size}px`}
          className="object-cover"
        />
      ) : (
        <span className="flex h-full items-center justify-center p-1 text-center text-[9px] leading-tight text-muted">
          {game.name}
        </span>
      )}
    </div>
  );
}

function DraggableGameCard({ game }: { game: TierlistGame }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: game.id,
  });
  const style: CSSProperties | undefined = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`touch-none ${isDragging ? "opacity-30" : ""}`}
    >
      <GameCover game={game} />
    </div>
  );
}

function TierRow({ tier, games }: { tier: Tier; games: TierlistGame[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: tier });

  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border border-border">
      <div
        className={`flex w-12 shrink-0 items-center justify-center text-lg font-bold sm:w-14 ${TIER_INTENSITY_CLASSES[tier]}`}
      >
        {tier}
      </div>
      <div
        ref={setNodeRef}
        className={`flex min-h-16 flex-1 flex-wrap items-center gap-2 bg-surface p-2 transition-colors ${
          isOver ? "bg-accent/10" : ""
        }`}
      >
        {games.length === 0 && <span className="px-1 text-xs text-faint">—</span>}
        {games.map((g) => (
          <DraggableGameCard key={g.id} game={g} />
        ))}
      </div>
    </div>
  );
}

function UnrankedPool({ games }: { games: TierlistGame[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: UNRANKED_ID });

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-muted">
        Non classé{games.length > 0 ? ` (${games.length})` : ""}
      </p>
      <div
        ref={setNodeRef}
        className={`flex min-h-16 flex-wrap gap-2 rounded-lg border border-dashed border-border bg-background p-2 transition-colors ${
          isOver ? "border-accent bg-accent/5" : ""
        }`}
      >
        {games.length === 0 && (
          <span className="px-1 text-xs text-faint">Tout est classé 🎉</span>
        )}
        {games.map((g) => (
          <DraggableGameCard key={g.id} game={g} />
        ))}
      </div>
    </div>
  );
}

/**
 * Tierlist perso (PR 6/9) — glisser-déposer choisi explicitement par
 * l'utilisateur plutôt qu'un tap-to-assign (plus "vraie tierlist"
 * visuellement). `@dnd-kit/core` seul (pas `@dnd-kit/sortable`) : l'ordre
 * *dans* une rangée n'a pas de sens pour une tierlist, seule la rangée
 * compte — pas besoin de tri interne.
 *
 * `PointerSensor` avec un seuil d'activation de quelques pixels : sans ça,
 * le moindre tap déclencherait un drag et casserait le scroll tactile de
 * la page sur mobile. `touch-none` sur chaque carte (voir
 * `DraggableGameCard`) est requis en complément — sans lui, le navigateur
 * capte le geste comme un scroll natif avant que dnd-kit ne le voie.
 *
 * Mise à jour optimiste + `setGameTierAction` en arrière-plan (même
 * philosophie que `VoteButton`), mais sans toast à chaque drop : sur une
 * bibliothèque de plusieurs dizaines de jeux, un toast par carte déplacée
 * serait juste du bruit — le déplacement visuel de la carte est déjà le
 * retour immédiat.
 */
export function TierlistBoard({
  games,
  initialTiers,
}: {
  games: TierlistGame[];
  initialTiers: Partial<Record<string, Tier>>;
}) {
  const [tierByGameId, setTierByGameId] = useState(initialTiers);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // Le filtre ne masque que l'affichage des cartes — `tierByGameId` (état
  // source de vérité pour le drag & drop) n'est jamais touché, donc
  // filtrer puis effacer la recherche ne fait perdre aucun classement.
  const q = filter.trim().toLowerCase();
  const visibleGames = q ? games.filter((g) => g.name.toLowerCase().includes(q)) : games;

  const gamesByTier = new Map<Tier, TierlistGame[]>(TIER_ORDER.map((t) => [t, []]));
  const unranked: TierlistGame[] = [];
  for (const game of visibleGames) {
    const tier = tierByGameId[game.id];
    if (tier) gamesByTier.get(tier)?.push(game);
    else unranked.push(game);
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const gameId = String(event.active.id);
    const overId = event.over?.id;
    if (!overId) return;

    const nextTier = overId === UNRANKED_ID ? undefined : (overId as Tier);
    const currentTier = tierByGameId[gameId];
    if (nextTier === currentTier) return;

    setTierByGameId((prev) => {
      const next = { ...prev };
      if (nextTier) next[gameId] = nextTier;
      else delete next[gameId];
      return next;
    });

    const formData = new FormData();
    formData.set("gameId", gameId);
    if (nextTier) formData.set("tier", nextTier);
    startTransition(async () => {
      await setGameTierAction(formData);
    });
  }

  const activeGame = activeId ? games.find((g) => g.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col gap-6">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrer par nom…"
          aria-label="Filtrer la tierlist par nom"
          className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />

        <div className="flex flex-col gap-2">
          {TIER_ORDER.map((tier) => (
            <TierRow key={tier} tier={tier} games={gamesByTier.get(tier) ?? []} />
          ))}
        </div>
        <UnrankedPool games={unranked} />
      </div>
      <DragOverlay>
        {activeGame ? <GameCover game={activeGame} size={64} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
