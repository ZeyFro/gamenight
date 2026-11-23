import type { Metadata } from "next";

/** Textes publics de l'aperçu du site (balises og/twitter, image d'aperçu) : statiques, jamais de donnée de compte. */
export const SITE_NAME = "GameNight";
export const SITE_DESCRIPTION =
  "GameNight, l'appli des soirées jeux de The Tower : votes, tournois, défis et classements entre potes. Connexion avec Discord.";
export const SITE_TAGLINE = "Les soirées jeux de The Tower";

/**
 * Métadonnées d'aperçu du site (audit du 23/11/2026, constats 3.1 à 3.3). Un robot non connecté ne voit que la page de connexion :
 * métadonnées STATIQUES et publiques seulement, jamais de titre de soirée privée. `origin` vient de `resolveAppOrigin` (variables
 * Vercel, aucun domaine codé en dur) ; `null` (dev local) : `metadataBase` omise, Next garde son comportement par défaut.
 */
export function siteMetadata(origin: string | null): Pick<Metadata, "metadataBase" | "title" | "description" | "openGraph" | "twitter"> {
  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: { default: SITE_NAME, template: "%s · GameNight" },
    description: SITE_DESCRIPTION,
    openGraph: { type: "website", siteName: SITE_NAME, title: SITE_NAME, description: SITE_DESCRIPTION, locale: "fr_FR" },
    twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION },
  };
}
