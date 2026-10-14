"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  ignoreToVerifierGame,
  setToVerifierGamePlayInfo,
  type ToVerifierMode,
} from "@/app/bibliotheque/actions";

export interface ToVerifierGame {
  id: string;
  name: string;
  coverUrl: string | null;
  source: string;
}

const SOURCE_LABELS: Record<string, string> = {
  STEAM: "Steam",
  IGDB: "IGDB",
  MANUAL: "Manuel",
};

export function ToVerifierList({ games }: { games: ToVerifierGame[] }) {
  const [remaining, setRemaining] = useState(games);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  function removeAfter(gameId: string, run: () => Promise<unknown>) {
    setPendingIds((prev) => new Set(prev).add(gameId));
    startTransition(async () => {
      await run();
      setRemaining((prev) => prev.filter((g) => g.id !== gameId));
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(gameId);
        return next;
      });
    });
  }

  if (remaining.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">
          Rien à vérifier pour l&apos;instant — tous tes jeux ont un mode de
          jeu confirmé. 🎉
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-foreground">
        {remaining.length} jeu{remaining.length === 1 ? "" : "x"} à vérifier
      </p>
      <div className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {remaining.map((game) => (
            <motion.div
              key={game.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 60, transition: { duration: 0.2 } }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <Card className="flex items-center gap-3 p-3">
                <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded-md bg-surface-hover">
                  {game.coverUrl && (
                    <Image
                      src={game.coverUrl}
                      alt={game.name}
                      fill
                      sizes="44px"
                      className="object-cover"
                    />
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-medium text-foreground">
                      {game.name}
                    </p>
                    <Badge>{SOURCE_LABELS[game.source] ?? game.source}</Badge>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <ModeButton
                      label="Coop"
                      disabled={isPending && pendingIds.has(game.id)}
                      onClick={() =>
                        removeAfter(game.id, () =>
                          setToVerifierGamePlayInfo(game.id, "coop" as ToVerifierMode)
                        )
                      }
                    />
                    <ModeButton
                      label="Multijoueur"
                      disabled={isPending && pendingIds.has(game.id)}
                      onClick={() =>
                        removeAfter(game.id, () =>
                          setToVerifierGamePlayInfo(game.id, "multi" as ToVerifierMode)
                        )
                      }
                    />
                    <ModeButton
                      label="Solo uniquement"
                      disabled={isPending && pendingIds.has(game.id)}
                      onClick={() =>
                        removeAfter(game.id, () =>
                          setToVerifierGamePlayInfo(game.id, "solo" as ToVerifierMode)
                        )
                      }
                    />
                    <button
                      type="button"
                      disabled={isPending && pendingIds.has(game.id)}
                      onClick={() =>
                        removeAfter(game.id, () => ignoreToVerifierGame(game.id))
                      }
                      className="rounded-full border border-border px-3 py-1 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-50"
                    >
                      Ignorer
                    </button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ModeButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
    >
      ☐ {label}
    </button>
  );
}
