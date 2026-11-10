import { TOWER_RANK_PRESENTATION, type TowerPersonalRank } from "@/lib/tower-ranks";

/**
 * Pastille de couleur du rang. Seul le violet du Ranker a une valeur décidée (`TOWER_RANK_PRESENTATION`) ;
 * le bleu (Irregular) et l'or (High Ranker) sont décidés comme couleurs mais pas comme valeurs : les
 * deux teintes ci-dessous sont PROVISOIRES, à remplacer quand le propriétaire les aura fixées.
 */
const PROVISIONAL_DOT = { bleu: "#3b82f6", or: "#f59e0b" } as const;

function dotColor(rank: TowerPersonalRank): string {
  const presentation = TOWER_RANK_PRESENTATION[rank];
  return "hex" in presentation ? presentation.hex : PROVISIONAL_DOT[presentation.colorName];
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
