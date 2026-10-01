/**
 * Contrôle d'une URL de bannière collée par un utilisateur (`User.bannerUrl`,
 * rendue par un `<img>` cross-origin dans `BannerImage`).
 *
 * Cas réel (bannières GIF « invisibles », console `ERR_BLOCKED_BY_RESPONSE.
 * NotSameOrigin`) : le lien que l'on copie depuis la barre d'adresse de
 * klipy.com (`https://klipy.com/gifs/<slug>`) est une PAGE HTML, pas une
 * image. Cette page répond avec `Cross-Origin-Resource-Policy: same-origin`
 * (+ `X-Content-Type-Options: nosniff`) : le navigateur refuse de
 * l'embarquer dans un `<img>`. Rien à corriger côté app/`next.config`/en-têtes
 * (la réponse bloquante est celle de klipy, et un proxy ne récupérerait que
 * du HTML). Les fichiers médias, eux, vivent sur `static.klipy.com/...` et se
 * chargent normalement (`access-control-allow-origin: *`, sans CORP).
 * Le seul vrai remède est donc de refuser le lien de page avec un message
 * qui dit quoi copier à la place.
 */

export const KLIPY_PAGE_URL_MESSAGE =
  "Ce lien est une page klipy, pas une image. Ouvre le GIF, clic droit → « Copier l'adresse de l'image » (le lien doit commencer par static.klipy.com), ou télécharge le fichier et utilise « Uploader une image ».";

/** `null` si l'URL est acceptable, sinon le message FR à afficher. Pure (aucun réseau). */
export function findBannerUrlProblem(raw: string): string | null {
  let host: string;
  try {
    host = new URL(raw.trim()).hostname.toLowerCase();
  } catch {
    return null; // le format est validé ailleurs (`httpUrlSchema`)
  }
  if (host === "klipy.com" || host === "www.klipy.com") return KLIPY_PAGE_URL_MESSAGE;
  return null;
}
