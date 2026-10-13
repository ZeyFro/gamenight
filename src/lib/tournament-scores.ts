/** Saisie des scores de tournoi (drapeau `TOURNAMENT_SCORES_ENABLED`, éteint par défaut, actif seulement si la valeur vaut exactement `true`). */
export function isTournamentScoresEnabled(): boolean {
  return process.env.TOURNAMENT_SCORES_ENABLED === "true";
}

/**
 * Cohérence scores/gagnant : le gagnant doit avoir le score strictement le plus haut.
 * shortcut: règle stricte, pas de jeu « le plus bas gagne » ; à assouplir si un tel jeu apparaît.
 */
export function scoreConsistencyError(winnerSlot: 1 | 2, score1: number, score2: number): string | null {
  const [w, l] = winnerSlot === 1 ? [score1, score2] : [score2, score1];
  return w > l ? null : "Le gagnant doit avoir le score le plus élevé.";
}
