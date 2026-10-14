import { isPlayerCountCompatible } from "@/lib/player-count";

/** Filtre « nombre de joueurs » de la roulette (drapeau `ROULETTE_PLAYER_FILTER_ENABLED`, éteint sauf valeur exactement `true`). */
export function isRoulettePlayerFilterEnabled(): boolean {
  return process.env.ROULETTE_PLAYER_FILTER_ENABLED === "true";
}

export interface DrawCandidate {
  minPlayers: number | null;
  maxPlayers: number | null;
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
