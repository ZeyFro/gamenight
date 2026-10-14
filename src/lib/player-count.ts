/**
 * Un jeu accepte `count` joueurs si count ∈ [minPlayers ?? 2, maxPlayers].
 * 2 par défaut si non renseigné (cohérent avec l'ajout manuel et l'import Steam) ; pas de plafond si `max` est null.
 */
export function isPlayerCountCompatible(min: number | null, max: number | null, count: number): boolean {
  return count >= (min ?? 2) && (max === null || count <= max);
}
