export type TowerPersonalRank = "Irregular" | "Ranker" | "High Ranker";

/** Seuils décidés (docs/TOWER_DECISIONS_26_20261104.md) : étages GAGNÉS via les défis (Q1, `floorsClimbed`). */
export const TOWER_RANKER_FLOORS = 30;
export const TOWER_HIGH_RANKER_FLOORS = 100;

function toLevel(floor: number | bigint): bigint {
  const level = typeof floor === "bigint" ? floor : BigInt(floor);
  if (level < BigInt(0)) throw new RangeError("Étage invalide");
  return level;
}

function assertSeasons(completedSeasons: number): void {
  if (!Number.isInteger(completedSeasons) || completedSeasons < 0) throw new RangeError("Saisons terminées invalides");
}

/** App-only cosmetic status; does not assign Discord permissions or roles. */
export function getTowerPersonalRank(floor: number | bigint, completedSeasons: number): TowerPersonalRank {
  assertSeasons(completedSeasons);
  const level = toLevel(floor);
  if (level >= BigInt(TOWER_HIGH_RANKER_FLOORS) && completedSeasons >= 1) return "High Ranker";
  if (level >= BigInt(TOWER_RANKER_FLOORS)) return "Ranker";
  return "Irregular";
}

export type TowerRankStep = {
  /** Rang suivant, d'après les seuils décidés. */
  rank: Exclude<TowerPersonalRank, "Irregular">;
  /** Étages encore à gagner (0 si le seuil d'étages est déjà atteint). */
  floorsMissing: string;
  /** Vrai s'il manque encore une saison terminée (High Ranker seulement). */
  seasonMissing: boolean;
};

/** Ce qu'il manque pour le rang suivant ; `null` au rang le plus élevé. N'ajoute aucune règle. */
export function nextTowerRankStep(floor: number | bigint, completedSeasons: number): TowerRankStep | null {
  const rank = getTowerPersonalRank(floor, completedSeasons);
  if (rank === "High Ranker") return null;
  const level = toLevel(floor);
  const target = rank === "Irregular" ? TOWER_RANKER_FLOORS : TOWER_HIGH_RANKER_FLOORS;
  const missing = BigInt(target) - level;
  return {
    rank: rank === "Irregular" ? "Ranker" : "High Ranker",
    floorsMissing: (missing > BigInt(0) ? missing : BigInt(0)).toString(),
    seasonMissing: rank === "Ranker" && completedSeasons < 1,
  };
}

export const TOWER_RANK_PRESENTATION = {
  "Irregular": { colorName: "bleu" },
  "Ranker": { colorName: "violet", hex: "#8b5cf6" },
  "High Ranker": { colorName: "or" },
} as const;
