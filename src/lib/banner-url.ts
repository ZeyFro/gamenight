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

export const BANNER_PAGE_MESSAGE =
  "Ce lien est une page (Tenor ou Giphy), pas une image. Clic droit sur le GIF → « Copier l'adresse de l'image » (media.tenor.com, i.giphy.com…).";

// Hôtes dont seules les PAGES HTML (pas les médias) vivent sur le domaine nu.
const PAGE_HOSTS = ["tenor.com", "www.tenor.com", "giphy.com", "www.giphy.com"];

export const BANNER_HTTPS_MESSAGE = "L'adresse de l'image doit commencer par https://.";
export const BANNER_HOST_MESSAGE =
  "Cet hébergeur d'images n'est pas autorisé. Utilise « Uploader une image » ou un lien Discord, Klipy (static.klipy.com), Tenor, Giphy ou Imgur.";

/**
 * Hôtes autorisés pour une bannière collée (liste blanche : un `<img>`
 * vers un hôte arbitraire divulgue l'IP/le navigateur de chaque visiteur
 * du profil). Un nom listé autorise aussi ses sous-domaines.
 */
export const BANNER_ALLOWED_HOSTS = [
  "static.klipy.com",
  "cdn.discordapp.com",
  "media.discordapp.net",
  "imgur.com",
  "tenor.com",
  "giphy.com",
  "images.igdb.com",
  "cdn.akamai.steamstatic.com",
  "public.blob.vercel-storage.com",
] as const;

function isAllowedBannerHost(host: string): boolean {
  return BANNER_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * Vrai pour une URL qu'on SAIT ne pas être une image chargeable dans un
 * `<img>` : la page HTML de klipy / Tenor / Giphy (hôtes nus). Ce sont des
 * liens collés AVANT le refus à l'écriture (`findBannerUrlProblem`) et déjà
 * en base : les charger gaspille une requête qui sera bloquée
 * (`Cross-Origin-Resource-Policy`) et divulgue le visiteur à ces hôtes pour
 * rien. `BannerImage` affiche donc tout de suite le dégradé de secours. Ne
 * concerne QUE ces pages : un hôte hors liste blanche reste affiché comme
 * avant (anciennes bannières). Pure (aucun réseau).
 */
export function isKnownNonImageBannerUrl(raw: string): boolean {
  let host: string;
  try {
    host = new URL(raw.trim()).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === "klipy.com" || host === "www.klipy.com" || PAGE_HOSTS.includes(host);
}

/** `null` si l'URL est acceptable, sinon le message FR à afficher. Pure (aucun réseau). */
export function findBannerUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null; // le format est validé ailleurs (`httpUrlSchema`)
  }
  const host = url.hostname.toLowerCase();
  if (host === "klipy.com" || host === "www.klipy.com") return KLIPY_PAGE_URL_MESSAGE;
  if (PAGE_HOSTS.includes(host)) return BANNER_PAGE_MESSAGE;
  if (url.protocol !== "https:") return BANNER_HTTPS_MESSAGE;
  if (!isAllowedBannerHost(host)) return BANNER_HOST_MESSAGE;
  return null;
}
