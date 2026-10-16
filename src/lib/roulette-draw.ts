import { isPlayerCountCompatible } from "@/lib/player-count";

/** Filtre « nombre de joueurs » de la roulette (drapeau `ROULETTE_PLAYER_FILTER_ENABLED`, éteint sauf valeur exactement `true`). */
export function isRoulettePlayerFilterEnabled(): boolean {
  return process.env.ROULETTE_PLAYER_FILTER_ENABLED === "true";
}

export interface DrawCandidate {
  minPlayers: number | null;
  maxPlayers: number | null;
}

export interface WeightedDrawCandidate extends DrawCandidate {
  weight: number;
  recentlyPlayed: boolean;
}

/**
 * Tire un candidat uniformément. Filtre allumé : ne garde que les jeux qui acceptent `playerCount` ;
 * si aucun ne convient, tire sur tous (`fallback: true`). `chosen` est null sans candidat.
 * Pur : l'aléa est injecté (`rng` ∈ [0,1[).
 */
export function pickRouletteCandidate<T extends DrawCandidate>(
  candidates: T[],
  { playerCount, filterEnabled, rng = Math.random }: { playerCount: number; filterEnabled: boolean; rng?: () => number }
): { chosen: T | null; fallback: boolean } {
  if (candidates.length === 0) return { chosen: null, fallback: false };
  let pool = candidates;
  let fallback = false;
  if (filterEnabled) {
    const compatible = candidates.filter((c) => isPlayerCountCompatible(c.minPlayers, c.maxPlayers, playerCount));
    if (compatible.length > 0) pool = compatible;
    else fallback = true;
  }
  return { chosen: pool[Math.floor(rng() * pool.length)], fallback };
}

/** Favorise les jeux mieux classés et écarte les jeux récents si le pool le permet. */
export function pickWeightedRouletteCandidate<T extends WeightedDrawCandidate>(
  candidates: T[],
  { playerCount, filterEnabled, rng = Math.random }: { playerCount: number; filterEnabled: boolean; rng?: () => number }
): { chosen: T | null; fallback: boolean } {
  if (candidates.length === 0) return { chosen: null, fallback: false };
  let pool = candidates;
  let fallback = false;
  if (filterEnabled) {
    const compatible = candidates.filter((c) => isPlayerCountCompatible(c.minPlayers, c.maxPlayers, playerCount));
    if (compatible.length > 0) pool = compatible;
    else fallback = true;
  }
  const rested = pool.filter((c) => !c.recentlyPlayed);
  if (rested.length > 0) pool = rested;
  const totalWeight = pool.reduce((sum, candidate) => sum + Math.max(0, candidate.weight), 0);
  if (totalWeight === 0) return { chosen: pool[Math.floor(rng() * pool.length)], fallback };
  let target = rng() * totalWeight;
  for (const candidate of pool) {
    target -= Math.max(0, candidate.weight);
    if (target < 0) return { chosen: candidate, fallback };
  }
  return { chosen: pool[pool.length - 1], fallback };
}

/**
 * « Relancer » de la roulette instantanée : filtre allumé, tire parmi les segments dont le jeu n'a pas déjà été tiré dans la session du wizard.
 * `index` est celui du segment dans `segments` ; `exhausted` quand tous les jeux ont été tirés.
 */
export function pickInstantSegment<T extends DrawCandidate & { gameId: string }>(
  segments: T[],
  { drawnGameIds, ...options }: { drawnGameIds: ReadonlySet<string>; playerCount: number; filterEnabled: boolean; rng?: () => number }
): { index: number | null; fallback: boolean; exhausted: boolean } {
  // Flag éteint : comportement d'origine (nouveau tirage uniforme, doublons possibles).
  const remaining = segments.map((s, index) => ({ ...s, index })).filter((s) => !options.filterEnabled || !drawnGameIds.has(s.gameId));
  const { chosen, fallback } = pickRouletteCandidate(remaining, options);
  return { index: chosen ? chosen.index : null, fallback, exhausted: chosen === null };
}
