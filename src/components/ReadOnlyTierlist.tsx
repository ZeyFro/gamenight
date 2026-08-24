import Image from "next/image";
import type { Tier } from "@prisma/client";
import { TIER_INTENSITY_CLASSES, TIER_ORDER } from "@/lib/tierlist";

export interface TierlistRowGame {
  id: string;
  name: string;
  coverUrl: string | null;
}

/**
 * Version lecture seule de `TierlistBoard`, pour /potes/[id] — pas de
 * `@dnd-kit`, juste les rangées non vides (une rangée S/A/B/C/D sans jeu
 * n'apparaît pas, contrairement à l'écran d'édition qui montre toujours
 * les 5 rangées pour qu'on puisse y déposer une carte).
 */
export function ReadOnlyTierlist({
  gamesByTier,
  emptyMessage,
}: {
  gamesByTier: Partial<Record<Tier, TierlistRowGame[]>>;
  emptyMessage: string;
}) {
  const nonEmptyTiers = TIER_ORDER.filter((t) => (gamesByTier[t]?.length ?? 0) > 0);

  if (nonEmptyTiers.length === 0) {
    return <p className="text-sm text-muted">{emptyMessage}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {nonEmptyTiers.map((tier) => (
        <div
          key={tier}
          className="flex items-stretch overflow-hidden rounded-lg border border-border"
        >
          <div
            className={`flex w-12 shrink-0 items-center justify-center text-lg font-bold ${TIER_INTENSITY_CLASSES[tier]}`}
          >
            {tier}
          </div>
          <div className="flex flex-1 flex-wrap items-center gap-2 bg-surface p-2">
            {gamesByTier[tier]!.map((g) => (
              <div
                key={g.id}
                title={g.name}
                className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-background"
              >
                {g.coverUrl ? (
                  <Image
                    src={g.coverUrl}
                    alt={g.name}
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center p-0.5 text-center text-[8px] leading-tight text-muted">
                    {g.name}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
