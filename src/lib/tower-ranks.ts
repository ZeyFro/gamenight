export type TowerPersonalRank = "Irregular" | "Ranker" | "High Ranker";

/** App-only cosmetic status; does not assign Discord permissions or roles. */
export function getTowerPersonalRank(floor: number | bigint, completedSeasons: number): TowerPersonalRank {
  if (!Number.isInteger(completedSeasons) || completedSeasons < 0) throw new RangeError("Saisons terminées invalides");
  const level = typeof floor === "bigint" ? floor : BigInt(floor);
  if (level < BigInt(0)) throw new RangeError("Étage invalide");
  if (level >= BigInt(100) && completedSeasons >= 1) return "High Ranker";
  if (level >= BigInt(30)) return "Ranker";
  return "Irregular";
}

export const TOWER_RANK_PRESENTATION = {
  "Irregular": { colorName: "bleu" },
  "Ranker": { colorName: "violet", hex: "#8b5cf6" },
  "High Ranker": { colorName: "or" },
} as const;
