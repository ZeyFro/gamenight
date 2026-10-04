/**
 * Accueil v2 (`/accueil-v2`) : mêmes données et mêmes contenus que l'accueil
 * actuel (`/`), hiérarchie et espacement revus. Page de comparaison derrière
 * le drapeau `HOME_V2_ENABLED` (éteint par défaut, actif uniquement si la
 * valeur vaut exactement `true`) : éteint, la route répond 404.
 */
export function isHomeV2Enabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.HOME_V2_ENABLED === "true";
}
