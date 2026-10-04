/**
 * Lien d'évitement « Aller au contenu » (accessibilité clavier, WCAG 2.4.1).
 * Derrière le drapeau `SKIP_LINK_ENABLED` (éteint par défaut, actif uniquement
 * si la valeur vaut exactement `true`) : éteint, le layout reste identique.
 */
export const SKIP_LINK_TARGET_ID = "contenu";

export function isSkipLinkEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SKIP_LINK_ENABLED === "true";
}
