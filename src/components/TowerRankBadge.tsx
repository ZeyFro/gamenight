import { TOWER_RANK_PRESENTATION, type TowerPersonalRank } from "@/lib/tower-ranks";

function dotColor(rank: TowerPersonalRank): string {
  return TOWER_RANK_PRESENTATION[rank].hex;
}

/**
 * Rang personnel Tower (cosmétique, sans rôle Discord). Le libellé reste dans la couleur de texte du
 * thème : la couleur du rang n'est portée que par la pastille, donc jamais par le contraste du texte.
 */
export function TowerRankBadge({ rank, className = "" }: { rank: TowerPersonalRank; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-foreground ${className}`}
      title={`Rang The Tower : ${rank}`}
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: dotColor(rank) }} />
      <span className="sr-only">Rang The Tower : </span>
      {rank}
    </span>
  );
}
