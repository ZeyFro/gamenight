/**
 * Grades Tower (décisions du 17/11/2026, docs/DECISIONS_TOWER.md) : Régulars dès l'inscription ;
 * Irregular = attribution manuelle du staff (prestige) ; Ranker ≥ 30 étages ; High Ranker ≥ 100 étages
 * ET au moins 5 défis validés sur la saison en cours. Statut cosmétique : aucun grade ne donne de droit de
 * modération ni de rôle Discord.
 */
export type TowerPersonalRank = "Régulars" | "Irregular" | "Ranker" | "High Ranker";

/** Étages GAGNÉS via les défis (`floorsClimbed`) : permanents entre les saisons. */
export const TOWER_RANKER_FLOORS = 30;
export const TOWER_HIGH_RANKER_FLOORS = 100;
/** Défis validés (réussites créditées) pendant la saison en cours, requis pour High Ranker. */
export const TOWER_HIGH_RANKER_SEASON_CHALLENGES = 5;

function toLevel(floor: number | bigint): bigint {
  const level = typeof floor === "bigint" ? floor : BigInt(floor);
  if (level < BigInt(0)) throw new RangeError("Étage invalide");
  return level;
}

function assertChallenges(seasonChallenges: number): void {
  if (!Number.isInteger(seasonChallenges) || seasonChallenges < 0) throw new RangeError("Défis validés invalides");
}

export type TowerRankOptions = {
  /** Irregular est attribué à la main par le staff : jamais déduit des étages. */
  irregularGranted?: boolean;
};

/**
 * Grade affiché. Un grade gagné (Ranker, High Ranker) l'emporte sur Irregular, qui l'emporte sur Régulars.
 * `seasonChallenges` = défis validés sur la saison en cours (0 hors saison).
 */
export function getTowerPersonalRank(floor: number | bigint, seasonChallenges: number, options: TowerRankOptions = {}): TowerPersonalRank {
  assertChallenges(seasonChallenges);
  const level = toLevel(floor);
  if (level >= BigInt(TOWER_HIGH_RANKER_FLOORS) && seasonChallenges >= TOWER_HIGH_RANKER_SEASON_CHALLENGES) return "High Ranker";
  if (level >= BigInt(TOWER_RANKER_FLOORS)) return "Ranker";
  return options.irregularGranted ? "Irregular" : "Régulars";
}

export type TowerRankStep = {
  /** Prochain grade gagnable (Irregular n'est jamais une étape : attribution manuelle). */
  rank: "Ranker" | "High Ranker";
  /** Étages encore à gagner (0 si le seuil d'étages est déjà atteint). */
  floorsMissing: string;
  /** Défis encore à valider sur la saison en cours (0 pour Ranker). */
  challengesMissing: number;
};

/** Ce qu'il manque pour le grade suivant ; `null` au grade le plus élevé. N'ajoute aucune règle. */
export function nextTowerRankStep(floor: number | bigint, seasonChallenges: number, options: TowerRankOptions = {}): TowerRankStep | null {
  const rank = getTowerPersonalRank(floor, seasonChallenges, options);
  if (rank === "High Ranker") return null;
  const level = toLevel(floor);
  const toRanker = rank !== "Ranker";
  const target = toRanker ? TOWER_RANKER_FLOORS : TOWER_HIGH_RANKER_FLOORS;
  const missing = BigInt(target) - level;
  return {
    rank: toRanker ? "Ranker" : "High Ranker",
    floorsMissing: (missing > BigInt(0) ? missing : BigInt(0)).toString(),
    challengesMissing: toRanker ? 0 : Math.max(0, TOWER_HIGH_RANKER_SEASON_CHALLENGES - seasonChallenges),
  };
}

const TOWER_RANK_ORDER: Record<TowerPersonalRank, number> = {
  "Régulars": 0,
  Irregular: 1,
  Ranker: 2,
  "High Ranker": 3,
};

function assertTowerRank(rank: string): asserts rank is TowerPersonalRank {
  if (!Object.prototype.hasOwnProperty.call(TOWER_RANK_ORDER, rank)) throw new RangeError("Rang inconnu");
}

export function compareTowerRanks(a: TowerPersonalRank, b: TowerPersonalRank): number {
  assertTowerRank(a);
  assertTowerRank(b);
  return TOWER_RANK_ORDER[a] - TOWER_RANK_ORDER[b];
}

/**
 * Couleurs décidées : Régulars gris, Irregular violet, Ranker or, High Ranker rouge. Les noms de couleur sont
 * décidés ; les valeurs hexadécimales sont provisoires jusqu'à validation du propriétaire.
 */
export const TOWER_RANK_PRESENTATION = {
  "Régulars": { colorName: "gris", hex: "#6b7280" },
  "Irregular": { colorName: "violet", hex: "#8b5cf6" },
  "Ranker": { colorName: "or", hex: "#f59e0b" },
  "High Ranker": { colorName: "rouge", hex: "#dc2626" },
} as const satisfies Record<TowerPersonalRank, { colorName: string; hex: string }>;
