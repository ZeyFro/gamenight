/**
 * Vie privée des médias : vidéo YouTube embarquée sur la fiche d'un jeu (chargée
 * seulement après un clic) et accord des personnes visibles ou audibles dans la
 * galerie des soirées. Derrière le drapeau `MEDIA_PRIVACY_ENABLED` (éteint par
 * défaut, actif uniquement si la valeur vaut exactement `true`) : éteint, la
 * fiche garde l'iframe immédiate et la galerie sa case unique.
 */
export const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com/embed/";

export function isMediaPrivacyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.MEDIA_PRIVACY_ENABLED === "true";
}

/** L'accord des personnes reconnaissables ou audibles est une case distincte (`consentPeople`). */
export function isSessionGalleryPeopleConsent(value: unknown): boolean {
  return value === "on";
}
